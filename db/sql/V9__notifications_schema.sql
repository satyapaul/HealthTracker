-- =============================================================================
-- V9 — Notifications (in-app) schema (WP 4.1 — HLD §4.8, LLD §1.16 / §2.6)
-- Source of truth: LLD §1.16 (notifications table), §2.6 (notifications RLS).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 4.1): the `notifications` table backing the in-app channel. The
-- notification-dispatcher inserts one row per target user for an event; the
-- user's app reads/marks them. SMS/WhatsApp/email are transient (queue ->
-- provider) and are NOT persisted here; only the in-app channel is durable.
--
-- NO PHI: `payload` holds event-type + opaque ids + deep-link params only —
-- never clinical values, names, phone numbers, or message bodies
-- (conventions.md). The dispatcher is responsible for keeping payloads clean.
-- =============================================================================

-- ── 1.16 Table: notifications ─────────────────────────────────────────────────
CREATE TABLE notifications (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL
                    REFERENCES users (id) ON DELETE CASCADE,
    event_type  TEXT        NOT NULL,   -- e.g. 'FOLLOWUP_SUBMITTED', 'DOCTOR_RESPONDED'
    payload     JSONB       NOT NULL,   -- event-specific data (no raw PHI)
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id    ON notifications (user_id);
CREATE INDEX idx_notifications_user_read  ON notifications (user_id, read_at)
    WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_at ON notifications (created_at);

-- =============================================================================
-- 2.6 RLS — notifications
-- A user reads/updates only their own notifications; admin may read all. The
-- dispatcher inserts rows for arbitrary target users, so INSERT is allowed for
-- the app role without a per-row owner check (the dispatcher is trusted server
-- code; it never runs as a patient/doctor principal fabricating others' rows).
-- The read side is still strictly owner-scoped.
-- =============================================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON notifications TO ${app_db_role};

-- Owner reads their own notifications.
CREATE POLICY notifications_owner_select ON notifications
    FOR SELECT TO ${app_db_role}
    USING (
        user_id = app_current_user_id()
        OR app_current_role() = 'admin'
    );

-- Owner marks their own notifications read (read_at). Admin may update any.
CREATE POLICY notifications_owner_update ON notifications
    FOR UPDATE TO ${app_db_role}
    USING (
        user_id = app_current_user_id()
        OR app_current_role() = 'admin'
    )
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_current_role() = 'admin'
    );

-- Insert: the dispatcher creates in-app rows for target users. Allowed for the
-- app role (trusted server path). No owner predicate on WITH CHECK because the
-- dispatcher legitimately writes rows for users other than the current actor.
CREATE POLICY notifications_insert ON notifications
    FOR INSERT TO ${app_db_role}
    WITH CHECK (true);

-- No DELETE policy: notifications are not deleted via the app role (retention
-- is handled out of band). DELETE is therefore denied by RLS for all roles.
