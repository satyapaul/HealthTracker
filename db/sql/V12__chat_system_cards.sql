-- =============================================================================
-- V12 — Chat system-card insert policy (WP 5.2 — spec C-03, LLD §4.19)
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Automated "system event cards" are chat_messages rows with
-- sender_role = 'system' and sender_user_id = NULL (e.g. "Patient submitted
-- labs for 2026-08-16 at Sanjay Gandhi Memorial Hospital"). The V11 insert
-- policies (cm_patient_insert / cm_doctor_insert) both require
-- sender_user_id = app_current_user_id(), so a NULL-sender system card cannot
-- be inserted under them. This migration adds the dedicated system-card insert
-- policy.
--
-- TRUST MODEL (same pattern as notifications_insert / the virus scanner /
-- the milestone-evaluator): a system card is written by TRUSTED SERVER CODE
-- (the followup/dose/care-team/transfers Lambdas via postSystemCard), not by a
-- user fabricating a message. The policy therefore does not tie the row to the
-- acting principal — it only constrains the row to be a genuine system card
-- (sender_role='system' AND sender_user_id IS NULL). chat_messages remains
-- SELECT+INSERT only, so the transcript stays immutable (C-10): a system card
-- can be appended but never updated or deleted.
--
-- ⚠ Sign-off: this extends the V3-V11 RLS/authz backlog — a reviewer should
-- confirm the "trusted server inserts NULL-sender cards" posture is acceptable
-- (consistent with notifications_insert WITH CHECK (true)).
-- =============================================================================

CREATE POLICY cm_system_insert ON chat_messages
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        sender_role    = 'system'
        AND sender_user_id IS NULL
    );
