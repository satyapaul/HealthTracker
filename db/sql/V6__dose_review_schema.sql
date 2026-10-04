-- =============================================================================
-- V6 — Doctor review: dose-change audit, doctor response, doctor access
-- (WP 2.3 — spec §7.2 / §7.4)
-- Source of truth: LLD §1.8 (doctor_patient_assignments), §1.14 (dose_changes),
-- §1.15 (doctor_responses), §2.4 / §2.5 / §2.9 (RLS), §2.1 / §2.2 (the deferred
-- doctor policies now retrofitted), §4.4 (review flow).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 2.3): the doctor review path. A doctor reviews a PENDING follow-up
-- row, records prescribed doses (kept distinct from patient-reported doses),
-- the per-field dose-change audit, and a structured response; the row moves to
-- 'reviewed'. This migration also brings forward the minimal
-- `doctor_patient_assignments` table (Decision: Option A) so the doctor RLS +
-- authz are REAL and correctly gated now, instead of a throwaway interim gate.
--
-- WHAT THIS MIGRATION ADDS
--   1. doctor_patient_assignments (LLD §1.8) — the minimal doctor<->patient join
--      the baseline doctor policies key on. Phase 6 builds the richer care-team
--      model (authorization grants / primary-doctor / transfer) ON TOP of this.
--   2. dose_changes (LLD §1.14) — append-only per-field dose-change history.
--   3. doctor_responses (LLD §1.15) — one structured response per row (UNIQUE).
--   4. RLS for all three (LLD §2.4/§2.5/§2.9).
--   5. RETROFIT of the doctor policies deferred by V4/V5: patients_doctor_select
--      (§2.1) and fur_doctor_select / fur_doctor_update (§2.2), now that their
--      dependency (doctor_patient_assignments) exists. Patients still can't see
--      another patient's data; this only grants assigned doctors their access.
--
-- IMMUTABILITY (conventions.md "immutable records are immutable"):
--   dose_changes and doctor_responses are append-only. The app role is granted
--   SELECT + INSERT only (no UPDATE/DELETE) on both — enforced at the grant
--   level, not just by convention.
--
-- DEFERRED (unchanged):
--   - Milestone / reminder side-effects of the review flow (LLD §4.4 steps 8-9)
--     are Phase 4 — NOT created here.
--   - The v1.7 care-team predicate (primary_doctor_id OR doctor_authorizations)
--     and case-transfer time-bound read remain Phase 6; they extend, and stay
--     consistent with, the doctor_patient_assignments baseline added here.
-- =============================================================================

-- ── 1.8 Table: doctor_patient_assignments ────────────────────────────────────
CREATE TABLE doctor_patient_assignments (
    doctor_id       UUID        NOT NULL
                        REFERENCES users (id) ON DELETE CASCADE,
    patient_id      UUID        NOT NULL
                        REFERENCES patients (id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by     UUID        NOT NULL
                        REFERENCES users (id) ON DELETE RESTRICT,

    PRIMARY KEY (doctor_id, patient_id)
);

CREATE INDEX idx_dpa_patient_id   ON doctor_patient_assignments (patient_id);
CREATE INDEX idx_dpa_assigned_by  ON doctor_patient_assignments (assigned_by);

-- ── 1.14 Table: dose_changes (append-only audit) ─────────────────────────────
CREATE TABLE dose_changes (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    follow_up_row_id    UUID        NOT NULL
                            REFERENCES follow_up_rows (id) ON DELETE CASCADE,
    field_name          TEXT        NOT NULL,   -- canonical dose key, e.g. 'neoral_tac'
    old_value           TEXT,                   -- NULL when first prescribed
    new_value           TEXT        NOT NULL,
    changed_by          UUID        NOT NULL
                            REFERENCES users (id) ON DELETE RESTRICT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason              TEXT
);

CREATE INDEX idx_dose_changes_follow_up_row_id ON dose_changes (follow_up_row_id);
CREATE INDEX idx_dose_changes_changed_by       ON dose_changes (changed_by);
CREATE INDEX idx_dose_changes_changed_at       ON dose_changes (changed_at);

-- ── 1.15 Table: doctor_responses (one per row) ───────────────────────────────
CREATE TABLE doctor_responses (
    id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    follow_up_row_id            UUID        NOT NULL UNIQUE
                                    REFERENCES follow_up_rows (id) ON DELETE CASCADE,
    doctor_id                   UUID        NOT NULL
                                    REFERENCES users (id) ON DELETE RESTRICT,
    -- [{"code":"TAC_LEVEL","description":"Repeat Tac/C0 in 7 days","due_date":"2026-08-23"}]
    additional_tests            JSONB       NOT NULL DEFAULT '[]',
    additional_medications      TEXT,
    clinical_notes              TEXT,
    next_followup_interval_days INT,
    sent_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doctor_responses_follow_up_row_id ON doctor_responses (follow_up_row_id);
CREATE INDEX idx_doctor_responses_doctor_id        ON doctor_responses (doctor_id);
CREATE INDEX idx_doctor_responses_sent_at          ON doctor_responses (sent_at);

-- =============================================================================
-- RLS — doctor_patient_assignments (LLD §2.9)
-- =============================================================================
ALTER TABLE doctor_patient_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_patient_assignments FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_patient_assignments TO ${app_db_role};

CREATE POLICY dpa_doctor_select ON doctor_patient_assignments
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND doctor_id = app_current_user_id()
    );

CREATE POLICY dpa_admin_all ON doctor_patient_assignments
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- =============================================================================
-- RLS — dose_changes (LLD §2.4). Append-only: SELECT + INSERT only.
-- =============================================================================
ALTER TABLE dose_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dose_changes FORCE  ROW LEVEL SECURITY;

-- No UPDATE/DELETE grant for the app role — the audit trail is immutable.
GRANT SELECT, INSERT ON dose_changes TO ${app_db_role};

-- Patient / caregiver: read dose changes on their own rows.
CREATE POLICY dc_patient_select ON dose_changes
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = app_current_patient_id()
        )
    );

-- Doctor: read dose changes on assigned patients' rows.
CREATE POLICY dc_doctor_select ON dose_changes
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    );

-- Doctor: insert dose changes on assigned patients' rows (write side of review).
CREATE POLICY dc_doctor_insert ON dose_changes
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    );

-- Admin: full read (admin writes go through app paths, not raw DML, but ALL is
-- consistent with the LLD; note the table has no UPDATE/DELETE grant anyway).
CREATE POLICY dc_admin_all ON dose_changes
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- =============================================================================
-- RLS — doctor_responses (LLD §2.5). Append-only: SELECT + INSERT only.
-- =============================================================================
ALTER TABLE doctor_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_responses FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON doctor_responses TO ${app_db_role};

-- Patient / caregiver: read the response on their own rows.
CREATE POLICY dr_patient_select ON doctor_responses
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = app_current_patient_id()
        )
    );

-- Doctor: read responses on assigned patients' rows.
CREATE POLICY dr_doctor_select ON doctor_responses
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    );

-- Doctor: insert a response for an assigned patient's row, as themselves.
CREATE POLICY dr_doctor_insert ON doctor_responses
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() = 'doctor'
        AND doctor_id = app_current_user_id()
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    );

CREATE POLICY dr_admin_all ON doctor_responses
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- =============================================================================
-- RETROFIT — doctor policies deferred by V4 (patients) and V5 (follow_up_rows).
-- Their dependency (doctor_patient_assignments) now exists, so an assigned
-- doctor can read the chart + the pending row they are reviewing, and update
-- the row during review (status->reviewed, doctor_prescribed_doses).
-- =============================================================================

-- patients: assigned doctor may read the chart (LLD §2.1 doctor policy).
CREATE POLICY patients_doctor_select ON patients
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    );

-- follow_up_rows: assigned doctor may read assigned patients' rows (LLD §2.2).
CREATE POLICY fur_doctor_select ON follow_up_rows
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    );

-- follow_up_rows: assigned doctor may update rows during review (LLD §2.2).
-- (The app only transitions pending->reviewed; the row-status guard lives in
-- the service/handler. RLS here scopes WHICH rows a doctor may touch at all.)
CREATE POLICY fur_doctor_update ON follow_up_rows
    FOR UPDATE TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    )
    WITH CHECK (
        app_current_role() = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    );
