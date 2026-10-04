-- =============================================================================
-- V5 — Follow-up row schema (WP 2.2 — spec §7.2.1)
-- Source of truth: LLD §1.11 (followup_status enum), §1.12 (follow_up_rows),
-- §1.26 (v1.7 engagement-hospital columns), §1.27 (updated_at trigger),
-- §2.2 (follow_up_rows RLS policies).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 2.2): the `follow_up_rows` table — one dated row per follow-up in
-- the clinical flowchart — with the full §7.2.1 field catalog stored in three
-- JSONB columns (lab_values / drug_levels / patient_reported_doses), the
-- required engagement-hospital columns, the updated_at trigger, and the
-- patient/caregiver + admin RLS policies.
--
-- THREE DELIBERATE DEFERRALS (confirmed with the product owner for WP 2.2 —
-- consistent with the WP 2.1 pattern):
--
--   1. HOSPITAL FK (Decision 1 — Option A). `hospitals` is a Phase 3 domain and
--      does not exist yet, so engagement_hospital_id is created here as a plain
--      UUID column (NOT NULL — this is a NEW table, so no backfill is needed,
--      unlike the LLD §1.26 ALTER on a pre-existing table). The real
--      `REFERENCES hospitals(id) ON DELETE RESTRICT` constraint is added by the
--      Phase 3 hospitals migration. Until then the application validates the id
--      and enforces the "required on submit" rule (spec §7.2.1).
--
--   2. DOCTOR RLS (Decision 2 — defer care-team to Phase 6). The doctor-select
--      and doctor-update policies (LLD §2.2) and the transferred-doctor policy
--      depend on doctor_patient_assignments / case_transfer_log, which do not
--      exist until Phase 6. This migration ships the patient/caregiver policies
--      (select / insert / update-draft-only) and the admin-all policy — all of
--      which reference only existing columns and session vars. Doctors are
--      fail-closed until the Phase 6 care-team migration adds their policies.
--
--   3. DOCTOR REVIEW TABLES (Decision 3 — WP 2.3). The follow_up_rows table is
--      created complete here (including doctor_prescribed_doses / reviewed_at /
--      reviewed_by and the hospital-correction audit columns) so WP 2.3 does
--      not have to ALTER it. But the dose_changes and doctor_responses tables
--      and their RLS, plus the doctor review/prescribe endpoints, are WP 2.3.
--
-- The three JSONB field groups (LLD §1.12), canonical keys from spec §7.2.1:
--   lab_values             — hb, tlc, plt, afp, inr, ptt, bilirubin_total,
--                            bilirubin_direct, sgot, sgpt, alk_phos, ggt,
--                            albumin, na_k, urea, creatinine, hba1c
--   drug_levels            — tac_level, evo_level
--   patient_reported_doses — neoral_tac, everolimus, aza_mpa, pred
--   (weight -> weight_kg column; comments -> notes column)
-- =============================================================================

-- ── 1.11 Enum: followup_status ───────────────────────────────────────────────
CREATE TYPE followup_status AS ENUM (
    'draft',      -- patient is still entering; editable; no notifications
    'pending',    -- submitted for doctor review
    'reviewed'    -- doctor has reviewed/prescribed (WP 2.3)
);

-- ── 1.12 Table: follow_up_rows ────────────────────────────────────────────────
CREATE TABLE follow_up_rows (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id              UUID            NOT NULL
                                REFERENCES patients (id) ON DELETE CASCADE,
    pp_date                 DATE            NOT NULL,
    status                  followup_status NOT NULL DEFAULT 'draft',

    -- §7.2.1 field catalog (canonical keys), partial entry allowed.
    lab_values              JSONB           NOT NULL DEFAULT '{}',
    drug_levels             JSONB           NOT NULL DEFAULT '{}',
    patient_reported_doses  JSONB           NOT NULL DEFAULT '{}',
    -- Filled by the doctor on review (WP 2.3); same shape as patient doses.
    doctor_prescribed_doses JSONB,

    weight_kg               NUMERIC(5,2),
    notes                   TEXT,                       -- row "Comments" (§7.2.5)

    -- ── v1.7 engagement hospital (LLD §1.26 — spec §7.2.1) ───────────────────
    -- Required on every row. Plain UUID now (Deferral 1); FK to hospitals(id)
    -- added by the Phase 3 hospitals migration. engagement_hospital_name is a
    -- denormalized snapshot captured at submission so the chart stays readable
    -- if the hospital is later renamed/deactivated.
    engagement_hospital_id   UUID           NOT NULL,
    engagement_hospital_name TEXT           NOT NULL,
    -- Doctor hospital-correction audit (populated during WP 2.3 review).
    corrected_by            UUID
                                REFERENCES users (id) ON DELETE SET NULL,
    corrected_at            TIMESTAMPTZ,
    correction_reason       TEXT,

    submitted_at            TIMESTAMPTZ,
    reviewed_at             TIMESTAMPTZ,
    reviewed_by             UUID
                                REFERENCES users (id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- One row per patient per follow-up date (spec §7.2 — dated rows).
    CONSTRAINT uq_follow_up_rows_patient_pp_date
        UNIQUE (patient_id, pp_date)
);

CREATE INDEX idx_fur_patient_id       ON follow_up_rows (patient_id);
CREATE INDEX idx_fur_status           ON follow_up_rows (status);
CREATE INDEX idx_fur_patient_status   ON follow_up_rows (patient_id, status);
CREATE INDEX idx_fur_pp_date          ON follow_up_rows (pp_date);
CREATE INDEX idx_fur_submitted_at     ON follow_up_rows (submitted_at)
    WHERE submitted_at IS NOT NULL;
CREATE INDEX idx_fur_reviewed_by      ON follow_up_rows (reviewed_by)
    WHERE reviewed_by IS NOT NULL;
CREATE INDEX idx_fur_engagement_hospital ON follow_up_rows (engagement_hospital_id);

-- ── 1.27 updated_at trigger ───────────────────────────────────────────────────
-- set_updated_at() was created in V4 (CREATE OR REPLACE); reuse it here.
CREATE TRIGGER trg_follow_up_rows_updated_at
    BEFORE UPDATE ON follow_up_rows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2.2 Row-Level Security — follow_up_rows
-- Source of truth: LLD §2.2 + .kiro/steering/conventions.md.
--
-- Policies shipped here (reference only existing columns / session vars):
--   • patient/caregiver — own patient's rows: SELECT, INSERT, and UPDATE
--     (UPDATE restricted to status='draft' — a submitted row is immutable to
--     the patient).
--   • admin             — full access (ALL).
-- DEFERRED to Phase 6 (care-team dependency): doctor select/update + the
-- transferred-doctor policy.
-- =============================================================================

ALTER TABLE follow_up_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_rows FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON follow_up_rows TO ${app_db_role};

-- Patient / caregiver: read their own patient's rows.
CREATE POLICY fur_patient_select ON follow_up_rows
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id = app_current_patient_id()
    );

-- Patient / caregiver: insert rows only for their own patient id.
CREATE POLICY fur_patient_insert ON follow_up_rows
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id = app_current_patient_id()
    );

-- Patient / caregiver: update only their own DRAFT rows. A submitted
-- (pending/reviewed) row is immutable to the patient. WITH CHECK keeps the row
-- bound to the same patient and prevents editing out of draft via a crafted
-- payload (status transitions happen through the submit path, not a raw UPDATE).
CREATE POLICY fur_patient_update ON follow_up_rows
    FOR UPDATE TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id = app_current_patient_id()
        AND status = 'draft'
    )
    WITH CHECK (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id = app_current_patient_id()
    );

-- Admin: full access.
CREATE POLICY fur_admin_all ON follow_up_rows
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- NOTE (Deferral 2): doctor select/update and the transferred-doctor policy
-- (LLD §2.2 / §2.x) are intentionally NOT defined here — their predicates need
-- the Phase 6 care-team tables (doctor_patient_assignments / case_transfer_log).
-- Until then no `doctor` row satisfies any follow_up_rows policy (fail-closed).
