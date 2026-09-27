-- =============================================================================
-- V3 — RLS session-context convention (WP 1.3)
-- Source of truth: LLD §2 (Row-Level Security) + .kiro/steering/conventions.md
--
-- Establishes the session-variable CONTRACT that all Row-Level Security policies
-- depend on, plus small helper functions that read those settings. It does NOT
-- enable RLS on or create policies for the clinical tables — those tables
-- (patients, follow_up_rows, attachments, dose_changes, doctor_responses,
-- milestones, reminder_schedules, notifications, doctor_patient_assignments)
-- do not exist yet. Per the LLD, each clinical table's own migration (Phase 2+)
-- performs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY ...`
-- against these helpers. Adding those here would ALTER non-existent tables.
--
-- The application sets the three settings transaction-locally before every
-- user-scoped query via the shared helper in
-- apps/api/layers/common/nodejs (see withRlsContext / applyRlsContext), using
-- parameterized `set_config('app.current_*', $1, true)`:
--   app.current_user_id     — UUID of the authenticated user
--   app.current_role        — 'patient' | 'caregiver' | 'doctor' | 'admin'
--   app.current_patient_id  — linked patient UUID (patient/caregiver only; '' otherwise)
--
-- These helpers centralize the read side so Phase 2 policies stay concise and
-- consistent. All are STABLE (depend only on session settings) and safe to call
-- inside policy USING/WITH CHECK expressions.
-- =============================================================================

-- Current authenticated user id (NULL if unset). `missing_ok => true` so a
-- query outside a request context yields NULL rather than erroring.
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID
$$;

-- Current role string (NULL if unset). Returned as text; callers compare to the
-- role literals. Not cast to the user_role enum so an unexpected/blank value is
-- simply non-matching rather than an error.
CREATE OR REPLACE FUNCTION app_current_role()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_role', true), '')
$$;

-- Current linked patient id (NULL when unset/empty — i.e. doctor/admin, or any
-- non-patient context). The app guarantees a non-empty value only for
-- patient/caregiver roles.
CREATE OR REPLACE FUNCTION app_current_patient_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_patient_id', true), '')::UUID
$$;

COMMENT ON FUNCTION app_current_user_id() IS
    'RLS helper (WP 1.3): authenticated user id from app.current_user_id session var, or NULL.';
COMMENT ON FUNCTION app_current_role() IS
    'RLS helper (WP 1.3): authenticated role from app.current_role session var, or NULL.';
COMMENT ON FUNCTION app_current_patient_id() IS
    'RLS helper (WP 1.3): linked patient id from app.current_patient_id session var, or NULL.';
