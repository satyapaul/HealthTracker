-- =============================================================================
-- V2 — Application DB role & baseline grants
-- Source of truth: LLD §2 (Row-Level Security) + .kiro/steering/conventions.md
--
-- The application connects as the least-privilege role `${app_db_role}`
-- (default: postopcare_app). All PHI tables use PostgreSQL RLS, and the
-- application sets these session-local variables before every query:
--   app.current_user_id     — UUID of the authenticated user
--   app.current_role        — 'patient' | 'caregiver' | 'doctor' | 'admin'
--   app.current_patient_id  — linked patient UUID (patient/caregiver only)
--
-- RLS POLICY SCOPE: The auth/identity tables created in V1 are NOT per-patient
-- PHI and are accessed by the auth service, so per-row RLS policies are not
-- defined here. RLS ENABLE + policies land alongside the clinical tables
-- (patients, follow_up_rows, ...) in their migrations, per LLD §2.
--
-- Idempotent: safe to re-run (guards with IF NOT EXISTS / catalog checks).
-- The role is created WITHOUT LOGIN here; credentials/attributes for the real
-- login role are managed by infra (Secrets Manager) — this migration only
-- ensures the role exists and holds the right table privileges.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${app_db_role}') THEN
        CREATE ROLE ${app_db_role} NOLOGIN;
    END IF;
END
$$;

-- Allow the app role to use the schema and operate on current + future tables.
GRANT USAGE ON SCHEMA public TO ${app_db_role};

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app_db_role};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app_db_role};

-- Ensure the same privileges apply to tables/sequences created by later
-- migrations (so we do not have to re-grant per migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app_db_role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${app_db_role};
