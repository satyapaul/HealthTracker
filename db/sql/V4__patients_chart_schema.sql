-- =============================================================================
-- V4 — Patient chart schema (WP 2.1 — spec §7.1)
-- Source of truth: LLD §1.7 (patients table), §1.25 (v1.7 hospital/primary-doctor
-- header fields), §1.27 (updated_at trigger), §2.1 (patients RLS policies).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 2.1): the `patients` table (clinical chart header), the deferred
-- users.linked_patient_id FK, the patient hospital/primary-doctor header
-- columns, the updated_at trigger, and the patient/caregiver + admin RLS
-- policies.
--
-- TWO DELIBERATE DEFERRALS (confirmed with the product owner for WP 2.1):
--
--   1. HOSPITAL FKs (Decision 1 — Option A). The `hospitals` table is a Phase 3
--      domain (WP 3.1) and does not exist yet, so a real FK constraint cannot
--      reference it. Per LLD §1.25, procedure_hospital_id / default_followup_
--      hospital_id are therefore added here as plain UUID columns; the actual
--      `REFERENCES hospitals(id) ON DELETE RESTRICT` constraints are added by
--      the Phase 3 hospitals migration via ALTER TABLE. Until then the
--      application layer validates these ids. primary_doctor_id DOES get its FK
--      now because `users` already exists (V1).
--
--   2. DOCTOR RLS (Decision 2 — defer care-team to Phase 6). The doctor-select
--      policy (LLD §2.1) depends on a care-team table (doctor_patient_assignments
--      / doctor_authorizations) that does not exist until Phase 6. Enabling it
--      here would reference a non-existent relation. This migration ships the
--      patient/caregiver own-row policies and the admin-all policy — all of
--      which reference only existing columns and session vars. The doctor-select
--      policy lands in the Phase 6 care-team migration, alongside its table.
--      This mirrors the deferral pattern used by V3 (RLS helpers without
--      policies on not-yet-existent tables).
--
-- Idempotency: this is a Flyway versioned migration — it runs exactly once and
-- is NOT re-run. We still guard the trigger function with CREATE OR REPLACE so
-- later migrations that also need set_updated_at() are consistent.
-- =============================================================================

-- ── 1.7 Table: patients ──────────────────────────────────────────────────────
-- Static clinical chart-header fields matching the paper form (spec §7.1).
CREATE TABLE patients (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    TEXT            NOT NULL,
    age_years               NUMERIC(4,1),
    sex                     CHAR(1)         CHECK (sex IN ('M', 'F', 'O')),
    max_id                  TEXT            NOT NULL UNIQUE,    -- hospital record number
    photo_url               TEXT,
    date_of_operation       DATE,
    diagnosis               TEXT,
    histopathology          TEXT,
    anastomosis_type        TEXT,
    contact_email           CITEXT,
    phone_number            TEXT,
    whatsapp_number         TEXT,
    -- { "sms_enabled": true, "whatsapp_enabled": true, "timezone": "Asia/Kolkata" }
    reminder_preferences    JSONB           NOT NULL
        DEFAULT '{"sms_enabled":true,"whatsapp_enabled":true,"timezone":"Asia/Kolkata"}',
    reminder_opt_out        BOOLEAN         NOT NULL DEFAULT FALSE,

    -- ── v1.7 header fields (LLD §1.25) ───────────────────────────────────────
    -- Hospital references are plain UUIDs for now (Deferral 1); the FK
    -- constraints to hospitals(id) are added by the Phase 3 hospitals migration.
    -- procedure_hospital_id is required at onboarding (enforced in the app
    -- layer); left nullable at the column level per the LLD.
    procedure_hospital_id        UUID,
    default_followup_hospital_id UUID,
    -- Anchors "who is the primary doctor" for the care-team access model
    -- (spec §7.9.1). users already exists, so this FK is created now.
    primary_doctor_id            UUID
        REFERENCES users (id) ON DELETE RESTRICT,

    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Lookup indexes (LLD §1.7 + §1.25).
CREATE INDEX idx_patients_max_id    ON patients (max_id);
CREATE INDEX idx_patients_name      ON patients (name);
CREATE INDEX idx_patients_phone     ON patients (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_patients_procedure_hospital
    ON patients (procedure_hospital_id) WHERE procedure_hospital_id IS NOT NULL;
CREATE INDEX idx_patients_primary_doctor
    ON patients (primary_doctor_id)     WHERE primary_doctor_id IS NOT NULL;

-- ── Deferred FK from users.linked_patient_id (V1) now that patients exists ────
ALTER TABLE users
    ADD CONSTRAINT fk_users_linked_patient
        FOREIGN KEY (linked_patient_id) REFERENCES patients (id) ON DELETE SET NULL;

-- ── 1.27 updated_at trigger ───────────────────────────────────────────────────
-- Shared trigger function; later clinical tables (follow_up_rows, hospitals)
-- reuse it. CREATE OR REPLACE so re-declaration in a later migration is a no-op.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2.1 Row-Level Security — patients
-- Source of truth: LLD §2.1 + .kiro/steering/conventions.md.
--
-- The application connects as the least-privilege role (V2) and sets these
-- transaction-local session vars before every query (V3 helpers read them):
--   app.current_user_id, app.current_role, app.current_patient_id
--
-- Policies shipped here (all reference only existing columns / session vars):
--   • patient/caregiver — own row only (SELECT, UPDATE)
--   • admin             — full access (ALL)
-- DEFERRED to Phase 6 (care-team dependency): the doctor-select policy.
-- =============================================================================

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO ${app_db_role};

-- Patient / caregiver: may read only their own linked chart. Uses the V3 STABLE
-- helpers so the predicate stays consistent and NULL-safe (an unset context
-- yields NULL and matches nothing).
CREATE POLICY patients_patient_select ON patients
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND id = app_current_patient_id()
    );

-- Patient / caregiver: may update only their own chart. WITH CHECK mirrors
-- USING so a row cannot be re-pointed to another patient on UPDATE.
CREATE POLICY patients_patient_update ON patients
    FOR UPDATE TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND id = app_current_patient_id()
    )
    WITH CHECK (
        app_current_role() IN ('patient', 'caregiver')
        AND id = app_current_patient_id()
    );

-- Admin: full access (onboarding creates patient charts; admin manages them).
CREATE POLICY patients_admin_all ON patients
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- NOTE (Deferral 2): doctor access to patient charts (primary doctor + active
-- care-team authorizations) is intentionally NOT defined here. It is added in
-- the Phase 6 care-team migration together with the table its predicate needs.
-- Until then, no `doctor` role row satisfies any patients policy, so doctors
-- are denied by default — which is the correct fail-closed posture.
