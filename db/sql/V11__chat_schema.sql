-- =============================================================================
-- V11 — Conversational chat schema (WP 5.1 — spec §7.8, LLD §1.21-1.24 / §2.14-2.15)
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 5.1): the chat backbone — threads, immutable messages, and
-- attachment metadata, with the WebSocket send/receive path. The chat_mark_read
-- security-definer function and read_by_user_ids column are created here (the
-- read-receipt FEATURE is WP 5.3, but the schema lands now so the transcript
-- table is not re-altered later).
--
-- IMMUTABILITY (C-10): chat_messages and chat_attachments are append-only. The
-- app role gets SELECT + INSERT only — NO UPDATE/DELETE. The sole permitted
-- mutation is appending a reader to chat_messages.read_by_user_ids, done ONLY
-- through the SECURITY DEFINER function chat_mark_read() (the base role cannot
-- UPDATE chat_messages directly).
--
-- TWO DELIBERATE DEFERRALS (approved pattern):
--   1. DOCTOR THREAD VISIBILITY (Phase 6 care-team). ct_doctor_select here uses
--      ONLY the patients.primary_doctor_id branch. The LLD's second branch — an
--      active doctor_authorizations grant — needs the Phase 6 care-team table
--      and is added then. Until then only a patient's primary doctor sees their
--      threads (fail-closed for co-managing/consulting doctors).
--   2. consult_view posting restriction is an app-layer check (chat service);
--      the consult_view role itself is Phase 6.
-- =============================================================================

-- ── 1.21 Chat enums ───────────────────────────────────────────────────────────
CREATE TYPE thread_type AS ENUM (
    'patient_care_team',        -- patient/caregiver + authorized doctors (C-01)
    'doctor_internal_consult'   -- doctors only; hidden from patients (C-08)
);

CREATE TYPE message_sender_role AS ENUM (
    'patient',
    'caregiver',
    'doctor',
    'system'                    -- automated event cards (C-03, WP 5.2)
);

CREATE TYPE urgency_flag AS ENUM (
    'routine_query',
    'symptom_concern'           -- highlighted in doctor dashboard (C-07, WP 5.3)
);

-- ── 1.22 Table: chat_threads ──────────────────────────────────────────────────
CREATE TABLE chat_threads (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id  UUID        NOT NULL
                    REFERENCES patients (id) ON DELETE CASCADE,
    thread_type thread_type NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_chat_thread_patient_type UNIQUE (patient_id, thread_type)
);

CREATE INDEX idx_chat_threads_patient_id ON chat_threads (patient_id);

-- ── 1.23 Table: chat_messages (append-only / immutable, C-10) ─────────────────
CREATE TABLE chat_messages (
    id                      UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id               UUID                NOT NULL
                                REFERENCES chat_threads (id) ON DELETE CASCADE,
    sender_user_id          UUID                                    -- NULL for system cards
                                REFERENCES users (id) ON DELETE SET NULL,
    sender_role             message_sender_role NOT NULL,
    body                    TEXT,                                   -- NULL if attachment-only
    urgency_flag            urgency_flag        NOT NULL DEFAULT 'routine_query',
    linked_follow_up_row_id UUID                                    -- contextual link (C-04)
                                REFERENCES follow_up_rows (id) ON DELETE SET NULL,
    -- Readers (C-05); appended only via chat_mark_read().
    read_by_user_ids        UUID[]              NOT NULL DEFAULT '{}',
    -- Held-for-scan: a message with a pending attachment is not delivered until
    -- the chat-media scan clears (HLD §4.7). TRUE = visible/delivered.
    is_released             BOOLEAN             NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_thread_id  ON chat_messages (thread_id, created_at);
CREATE INDEX idx_chat_messages_sender     ON chat_messages (sender_user_id)
    WHERE sender_user_id IS NOT NULL;
CREATE INDEX idx_chat_messages_urgency    ON chat_messages (thread_id, urgency_flag)
    WHERE urgency_flag = 'symptom_concern';
CREATE INDEX idx_chat_messages_linked_row ON chat_messages (linked_follow_up_row_id)
    WHERE linked_follow_up_row_id IS NOT NULL;

-- ── 1.24 Table: chat_attachments (reuses scan_status from V7) ─────────────────
CREATE TABLE chat_attachments (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id      UUID        NOT NULL
                        REFERENCES chat_messages (id) ON DELETE CASCADE,
    object_key      TEXT        NOT NULL UNIQUE,    -- S3 key in postopcare-chat-media
    mime_type       TEXT        NOT NULL,
    file_size_bytes BIGINT,
    scan_status     scan_status NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_attachments_message_id  ON chat_attachments (message_id);
CREATE INDEX idx_chat_attachments_scan_status ON chat_attachments (scan_status);

-- =============================================================================
-- 2.14 RLS — chat_threads
-- =============================================================================
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON chat_threads TO ${app_db_role};

-- Patient/caregiver: own patient_care_team thread only (internal consult hidden).
CREATE POLICY ct_patient_select ON chat_threads
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id  = app_current_patient_id()
        AND thread_type = 'patient_care_team'
    );

-- Patient/caregiver: create their own care-team thread.
CREATE POLICY ct_patient_insert ON chat_threads
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id  = app_current_patient_id()
        AND thread_type = 'patient_care_team'
    );

-- Doctor: threads for patients they are the PRIMARY doctor of. (Phase 6 adds
-- the second branch: an active doctor_authorizations grant.)
CREATE POLICY ct_doctor_select ON chat_threads
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND EXISTS (
            SELECT 1 FROM patients p
            WHERE p.id = chat_threads.patient_id
              AND p.primary_doctor_id = app_current_user_id()
        )
    );

CREATE POLICY ct_admin_all ON chat_threads
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- =============================================================================
-- 2.15 RLS — chat_messages & chat_attachments (immutable, C-10)
-- No UPDATE/DELETE grant → transcript is immutable. Read receipts are appended
-- ONLY via chat_mark_read() (SECURITY DEFINER), defined below.
-- =============================================================================
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON chat_messages TO ${app_db_role};

-- Patient/caregiver: released messages in their own care-team thread.
CREATE POLICY cm_patient_select ON chat_messages
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND is_released = TRUE
        AND thread_id IN (
            SELECT t.id FROM chat_threads t
            WHERE t.patient_id  = app_current_patient_id()
              AND t.thread_type = 'patient_care_team'
        )
    );

-- Patient/caregiver: post to their own care-team thread, as themselves.
CREATE POLICY cm_patient_insert ON chat_messages
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() IN ('patient', 'caregiver')
        AND sender_user_id = app_current_user_id()
        AND thread_id IN (
            SELECT t.id FROM chat_threads t
            WHERE t.patient_id  = app_current_patient_id()
              AND t.thread_type = 'patient_care_team'
        )
    );

-- Doctor: messages in any thread they can see (ct_doctor_select governs
-- visibility, so a bare thread_id membership check is sufficient here).
CREATE POLICY cm_doctor_select ON chat_messages
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND thread_id IN (SELECT id FROM chat_threads)
    );

CREATE POLICY cm_doctor_insert ON chat_messages
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() = 'doctor'
        AND sender_user_id = app_current_user_id()
        AND thread_id IN (SELECT id FROM chat_threads)
    );

CREATE POLICY cm_admin_select ON chat_messages
    FOR SELECT TO ${app_db_role}
    USING (app_current_role() = 'admin');

-- chat_attachments: visibility + insert follow the parent message.
ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachments FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON chat_attachments TO ${app_db_role};

CREATE POLICY catt_select ON chat_attachments
    FOR SELECT TO ${app_db_role}
    USING (message_id IN (SELECT id FROM chat_messages));

CREATE POLICY catt_insert ON chat_attachments
    FOR INSERT TO ${app_db_role}
    WITH CHECK (message_id IN (SELECT id FROM chat_messages));

CREATE POLICY catt_admin_all ON chat_attachments
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- ── Read-receipt mutation path (C-05): the ONLY permitted mutation on
-- chat_messages. SECURITY DEFINER so it runs with the function owner's rights
-- and can UPDATE read_by_user_ids even though the app role has no UPDATE grant.
-- It appends the reader exactly once (idempotent) and touches no other column.
CREATE OR REPLACE FUNCTION chat_mark_read(p_message_id UUID, p_reader_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE chat_messages
    SET    read_by_user_ids = array_append(read_by_user_ids, p_reader_id)
    WHERE  id = p_message_id
      AND  NOT (p_reader_id = ANY (read_by_user_ids));   -- append once only
END;
$$;

COMMENT ON FUNCTION chat_mark_read(UUID, UUID) IS
    'C-05 read receipt: sole permitted mutation of chat_messages — appends a '
    'reader to read_by_user_ids once. SECURITY DEFINER; the app role has no '
    'direct UPDATE on chat_messages (transcript immutable, C-10).';

-- The app role may execute the function but still cannot UPDATE the table.
GRANT EXECUTE ON FUNCTION chat_mark_read(UUID, UUID) TO ${app_db_role};
