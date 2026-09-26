-- =============================================================================
-- V1 — Baseline auth & identity schema
-- Source of truth: LLD §1.1–1.6 (docs/LLD-Technical-Design.md)
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1
--
-- Scope (WP 0.4): extensions, auth-related enum types, and the users /
-- auth_identities / auth_sessions / otp_challenges tables. Clinical tables
-- (patients, follow_up_rows, hospitals, chat, etc.) arrive in later phases.
--
-- NOTE: users.linked_patient_id references the patients table, which does not
-- exist yet. Per the LLD, that FK is added in a LATER migration (the migration
-- that creates `patients`), using ALTER TABLE ... ADD CONSTRAINT. It is left as
-- a plain UUID column here. Do NOT edit this applied migration to add it —
-- add a new versioned migration instead (see conventions.md).
-- =============================================================================

-- ── 1.1 Extensions ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- hashing (OTP, audit)
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive email lookups

-- ── 1.2 Enum types (auth subset) ────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
    'patient',
    'caregiver',
    'doctor',
    'admin'
);

CREATE TYPE user_status AS ENUM (
    'active',
    'pending_verification',
    'disabled'
);

CREATE TYPE auth_provider AS ENUM (
    'google',
    'x',
    'sms'
);

-- ── 1.3 Table: users ────────────────────────────────────────────────────────
CREATE TABLE users (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    role                user_role       NOT NULL,
    display_name        TEXT            NOT NULL,
    email               CITEXT          UNIQUE,
    phone_number        TEXT,
    status              user_status     NOT NULL DEFAULT 'pending_verification',
    -- For patient/caregiver accounts: references the patient record.
    -- FK to patients(id) is added in a later migration once patients exists.
    linked_patient_id   UUID,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ,

    CONSTRAINT users_email_or_phone_required
        CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);

CREATE INDEX idx_users_role           ON users (role);
CREATE INDEX idx_users_status         ON users (status);
CREATE INDEX idx_users_linked_patient ON users (linked_patient_id);
CREATE INDEX idx_users_phone          ON users (phone_number) WHERE phone_number IS NOT NULL;

-- ── 1.4 Table: auth_identities ──────────────────────────────────────────────
CREATE TABLE auth_identities (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID            NOT NULL
                            REFERENCES users (id) ON DELETE CASCADE,
    provider            auth_provider   NOT NULL,
    provider_subject    TEXT            NOT NULL,   -- OAuth sub or E.164 phone
    email_from_provider CITEXT,
    linked_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_auth_identities_provider_subject
        UNIQUE (provider, provider_subject)
);

CREATE INDEX idx_auth_identities_user_id ON auth_identities (user_id);

-- ── 1.5 Table: auth_sessions ────────────────────────────────────────────────
CREATE TABLE auth_sessions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL
                    REFERENCES users (id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    device_info JSONB,      -- { "userAgent": "...", "platform": "..." }
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_sessions_user_id    ON auth_sessions (user_id);
CREATE INDEX idx_auth_sessions_expires_at ON auth_sessions (expires_at)
    WHERE revoked_at IS NULL;

-- ── 1.6 Table: otp_challenges ───────────────────────────────────────────────
CREATE TABLE otp_challenges (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number    TEXT        NOT NULL,
    otp_hash        TEXT        NOT NULL,   -- bcrypt hash of the 6-digit code
    expires_at      TIMESTAMPTZ NOT NULL,
    attempts        INT         NOT NULL DEFAULT 0,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_challenges_phone      ON otp_challenges (phone_number);
CREATE INDEX idx_otp_challenges_expires_at ON otp_challenges (expires_at)
    WHERE verified_at IS NULL;
