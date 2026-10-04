-- =============================================================================
-- V7 — Lab-report attachments schema (WP 2.4 — spec §7.3 P-03)
-- Source of truth: LLD §1.11 (scan_status enum), §1.13 (attachments table),
-- §2.3 (attachments RLS), §4.3 (presign/confirm), §4.12 (virus-scan flow).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 2.4): the `attachments` table — lab-report files (PDF/image)
-- uploaded against a follow-up row via presigned S3 PUT, then virus-scanned.
-- A row is created on /confirm with scan_status='pending'; the virus-scan
-- Lambda flips it to 'clean' or 'quarantined'.
--
-- NOTES / BOUNDARIES
--   - scan_status enum is created HERE (it did not exist in V1-V6). The LLD
--     reuses the same enum for chat_attachments (Phase 5); defining it now is
--     forward-compatible.
--   - RLS (§2.3): patient/caregiver may read + insert attachments on their own
--     rows; an assigned doctor may read them (reuses doctor_patient_assignments
--     from V6); admin full. These reference only existing tables.
--   - Scanner write path: per LLD §2.3, the virus-scan Lambda updates
--     scan_status under a SCOPED SERVICE ROLE (not postopcare_app) and keys by
--     object_key, outside the RLS-bound app context. The app role retains
--     UPDATE here (consistent with the LLD grant) but the application code
--     never flips scan_status itself — that is the scanner's job. The scoped
--     role's grant is provisioned by infra, not this migration.
-- =============================================================================

-- ── 1.11 Enum: scan_status ───────────────────────────────────────────────────
CREATE TYPE scan_status AS ENUM (
    'pending',      -- uploaded, awaiting virus scan
    'clean',        -- scanned, safe to serve
    'quarantined'   -- infected; original deleted, copy in quarantine prefix
);

-- ── 1.13 Table: attachments ───────────────────────────────────────────────────
CREATE TABLE attachments (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    follow_up_row_id    UUID        NOT NULL
                            REFERENCES follow_up_rows (id) ON DELETE CASCADE,
    object_key          TEXT        NOT NULL UNIQUE,    -- S3 object key
    original_filename   TEXT        NOT NULL,
    mime_type           TEXT        NOT NULL,
    file_size_bytes     BIGINT,
    scan_status         scan_status NOT NULL DEFAULT 'pending',
    uploaded_by         UUID
                            REFERENCES users (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_follow_up_row_id ON attachments (follow_up_row_id);
CREATE INDEX idx_attachments_scan_status      ON attachments (scan_status);
CREATE INDEX idx_attachments_uploaded_by      ON attachments (uploaded_by)
    WHERE uploaded_by IS NOT NULL;

-- =============================================================================
-- 2.3 Row-Level Security — attachments
-- Source of truth: LLD §2.3 + .kiro/steering/conventions.md.
-- =============================================================================
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO ${app_db_role};

-- Patient / caregiver: read attachments on their own rows.
CREATE POLICY att_patient_select ON attachments
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = app_current_patient_id()
        )
    );

-- Patient / caregiver: attach a file to their own row (the /confirm insert).
CREATE POLICY att_patient_insert ON attachments
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = app_current_patient_id()
        )
    );

-- Doctor: read attachments on assigned patients' rows (reuses V6 assignments).
CREATE POLICY att_doctor_select ON attachments
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    );

-- Admin: full access.
CREATE POLICY att_admin_all ON attachments
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');
