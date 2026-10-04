-- =============================================================================
-- V8 — Hospital Registry (WP 3.1 — spec §7.0.1 / §7.0.2)
-- Source of truth: LLD §1.11 (hospital enums), §1.18 (hospitals + Virtual seed),
-- §1.19 (hospital_doctor_affiliations), §1.25/§1.26 (deferred FK wiring),
-- §1.27 (hospitals updated_at trigger), §2.10 / §2.11 (RLS).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 3.1): the hospital reference-data foundation —
--   • hospital_type / hospital_status / affiliation_status enums
--   • hospitals table + the system-seeded Virtual Hospital (well-known UUID)
--   • hospital_doctor_affiliations table
--   • RLS for both (read-all hospitals; admin manage; doctor sees own
--     affiliations; Virtual Hospital non-editable/non-deletable)
--   • WIRING the hospital FK constraints deferred by V4 (patients) and V5
--     (follow_up_rows) now that `hospitals` exists.
--
-- DoD: "Virtual record present, non-deletable." The Virtual Hospital is seeded
-- here; non-deletability is enforced by (a) NO delete policy on hospitals (RLS
-- denies DELETE for every role) and (b) the admin-update policy excluding the
-- well-known UUID, plus an app-layer guard (hospital lookup module).
--
-- BOOTSTRAP USER (seed dependency): hospitals.created_by is NOT NULL REFERENCES
-- users(id). The Virtual Hospital's created_by is the well-known system admin
-- '00000000-0000-0000-0000-000000000001'. That user row must exist before the
-- hospital seed, so we idempotently insert a system/bootstrap admin user first.
--
-- Admin hospital/affiliation CRUD endpoints are WP 3.2; the hospital picker is
-- WP 3.3. This migration provisions the schema + RLS those WPs build on.
-- =============================================================================

-- ── 1.11 Hospital enums ───────────────────────────────────────────────────────
CREATE TYPE hospital_type AS ENUM (
    'general',
    'specialty',
    'clinic',
    'daycare',
    'virtual'
);

CREATE TYPE hospital_status AS ENUM (
    'active',
    'inactive'
);

CREATE TYPE affiliation_status AS ENUM (
    'active',
    'inactive'
);

-- ── 1.18 Table: hospitals ──────────────────────────────────────────────────────
CREATE TABLE hospitals (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_code   TEXT            NOT NULL UNIQUE,    -- <= 20 chars; 'VIRTUAL' reserved
    hospital_name   TEXT            NOT NULL,
    hospital_type   hospital_type   NOT NULL,
    address_line1   TEXT,                               -- required except virtual (enforced in app)
    address_line2   TEXT,
    city            TEXT,                               -- required except virtual
    state           TEXT,
    country         TEXT,                               -- ISO 3166-1 alpha-2; required except virtual
    postal_code     TEXT,
    phone           TEXT,
    website_url     TEXT,
    logo_url        TEXT,                               -- object in postopcare-assets bucket
    status          hospital_status NOT NULL DEFAULT 'active',
    created_by      UUID            NOT NULL
                        REFERENCES users (id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT hospitals_code_len CHECK (char_length(hospital_code) <= 20)
);

CREATE INDEX idx_hospitals_status ON hospitals (status);
CREATE INDEX idx_hospitals_type   ON hospitals (hospital_type);
CREATE INDEX idx_hospitals_name   ON hospitals (hospital_name);
CREATE INDEX idx_hospitals_city   ON hospitals (city) WHERE city IS NOT NULL;

-- hospitals.updated_at maintenance (LLD §1.27; set_updated_at() created in V4).
CREATE TRIGGER trg_hospitals_updated_at
    BEFORE UPDATE ON hospitals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 1.19 Table: hospital_doctor_affiliations ─────────────────────────────────
CREATE TABLE hospital_doctor_affiliations (
    id               UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id        UUID                NOT NULL
                        REFERENCES users (id) ON DELETE CASCADE,
    hospital_id      UUID                NOT NULL
                        REFERENCES hospitals (id) ON DELETE RESTRICT,
    role_at_hospital TEXT,                               -- free text
    is_primary       BOOLEAN             NOT NULL DEFAULT FALSE,
    status           affiliation_status  NOT NULL DEFAULT 'active',
    granted_by       UUID                NOT NULL
                        REFERENCES users (id) ON DELETE RESTRICT,
    granted_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_hda_doctor_hospital UNIQUE (doctor_id, hospital_id)
);

CREATE INDEX idx_hda_doctor_id   ON hospital_doctor_affiliations (doctor_id);
CREATE INDEX idx_hda_hospital_id ON hospital_doctor_affiliations (hospital_id);
CREATE INDEX idx_hda_doctor_active ON hospital_doctor_affiliations (doctor_id, status)
    WHERE status = 'active';
-- At most one primary affiliation per doctor.
CREATE UNIQUE INDEX uq_hda_one_primary ON hospital_doctor_affiliations (doctor_id)
    WHERE is_primary = TRUE;

-- ── System bootstrap admin user (seed dependency for created_by) ──────────────
-- Well-known, non-routable system account. Not a login identity; it exists so
-- system-seeded rows (the Virtual Hospital) have a valid created_by/granted_by.
INSERT INTO users (id, role, display_name, email, status)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin',
    'System',
    'system@postopcare.invalid',
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- ── System-seeded Virtual Hospital (well-known UUID; H-07/H-10) ───────────────
INSERT INTO hospitals (id, hospital_code, hospital_name, hospital_type, status, created_by)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'VIRTUAL',
    'Virtual / Remote Consultation',
    'virtual',
    'active',
    '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Deferred FK wiring (Decision 2) — now that `hospitals` exists.
-- These columns were created as plain UUID in V4 (patients) and V5
-- (follow_up_rows) under the "Option A" deferral. No backfill is needed: this
-- is a fresh schema and the Virtual Hospital seed above guarantees the
-- well-known UUID is present before any row could reference it.
-- =============================================================================
ALTER TABLE patients
    ADD CONSTRAINT fk_patients_procedure_hospital
        FOREIGN KEY (procedure_hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_patients_default_followup_hospital
        FOREIGN KEY (default_followup_hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT;

ALTER TABLE follow_up_rows
    ADD CONSTRAINT fk_fur_engagement_hospital
        FOREIGN KEY (engagement_hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT;

-- =============================================================================
-- 2.10 RLS — hospitals (non-PHI reference data)
-- Any authenticated role may read; admin manages; Virtual Hospital is
-- non-editable and (no DELETE policy) non-deletable at the data layer.
-- =============================================================================
ALTER TABLE hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitals FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON hospitals TO ${app_db_role};

-- All authenticated roles can read hospitals (picker + chart-header rendering).
CREATE POLICY hospitals_read_all ON hospitals
    FOR SELECT TO ${app_db_role}
    USING (true);

-- Admin creates hospitals (H-01).
CREATE POLICY hospitals_admin_insert ON hospitals
    FOR INSERT TO ${app_db_role}
    WITH CHECK (app_current_role() = 'admin');

-- Admin edits/deactivates hospitals (H-02/H-03) — never the Virtual Hospital.
CREATE POLICY hospitals_admin_update ON hospitals
    FOR UPDATE TO ${app_db_role}
    USING (
        app_current_role() = 'admin'
        AND id <> '00000000-0000-0000-0000-000000000000'::UUID
    )
    WITH CHECK (
        app_current_role() = 'admin'
        AND id <> '00000000-0000-0000-0000-000000000000'::UUID
    );

-- No DELETE policy: DELETE is denied by RLS for all roles (hospitals are never
-- hard-deleted; the Virtual Hospital in particular is non-deletable).

-- =============================================================================
-- 2.11 RLS — hospital_doctor_affiliations
-- Admins manage all (H-04); doctors read their own (H-05).
-- =============================================================================
ALTER TABLE hospital_doctor_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospital_doctor_affiliations FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON hospital_doctor_affiliations TO ${app_db_role};

-- Doctor sees only their own affiliations (H-05).
CREATE POLICY hda_doctor_select ON hospital_doctor_affiliations
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND doctor_id = app_current_user_id()
    );

-- Admin manages all affiliations (H-04).
CREATE POLICY hda_admin_all ON hospital_doctor_affiliations
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');
