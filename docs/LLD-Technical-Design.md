# Low-Level Design — PostOp Care Platform

**Version:** 1.0  
**Date:** 2026-08-16  
**Based on:** Application Specification v1.3 + HLD v1.0  
**Region:** ap-south-1 (Mumbai)  
**Runtime:** Node.js 22 on AWS Lambda; PostgreSQL 16 on Aurora Serverless v2

---

## Table of Contents

1. [Database Schema (PostgreSQL DDL)](#1-database-schema-postgresql-ddl)
2. [Row-Level Security Policies](#2-row-level-security-policies)
3. [API Contracts](#3-api-contracts)
4. [Lambda Function Designs](#4-lambda-function-designs)
5. [Session & Cache (Redis Key Schema)](#5-session--cache-redis-key-schema)
6. [Notification Pipeline](#6-notification-pipeline)
7. [Milestone Scheduler](#7-milestone-scheduler)
8. [File Upload Flow](#8-file-upload-flow)
9. [Error Handling Standard](#9-error-handling-standard)

---

## 1. Database Schema (PostgreSQL DDL)

### 1.1 Extensions

```sql
-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgcrypto for hashing (OTP, audit)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- citext for case-insensitive email lookups
CREATE EXTENSION IF NOT EXISTS "citext";
```

---

### 1.2 Enum Types

```sql
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

CREATE TYPE milestone_type AS ENUM (
    'follow_up',
    'post_op_checkpoint',
    'drug_level',
    'doctor_ordered',
    'overdue'
);

CREATE TYPE milestone_status AS ENUM (
    'scheduled',
    'completed',
    'cancelled',
    'overdue'
);

CREATE TYPE milestone_source AS ENUM (
    'protocol',
    'doctor',
    'system'
);

CREATE TYPE reminder_type_enum AS ENUM (
    'advance',
    'due_day',
    'overdue',
    'final_overdue'
);

CREATE TYPE reminder_status AS ENUM (
    'pending',
    'sent',
    'cancelled',
    'failed'
);

CREATE TYPE followup_status AS ENUM (
    'draft',
    'pending',
    'reviewed'
);

CREATE TYPE scan_status AS ENUM (
    'pending',
    'clean',
    'quarantined'
);
```

---

### 1.3 Table: users

```sql
CREATE TABLE users (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    role                user_role       NOT NULL,
    display_name        TEXT            NOT NULL,
    email               CITEXT          UNIQUE,
    phone_number        TEXT,
    status              user_status     NOT NULL DEFAULT 'pending_verification',
    -- for patient/caregiver accounts: references the patient record
    linked_patient_id   UUID,           -- FK added after patients table creation (deferred)
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ,

    CONSTRAINT users_email_or_phone_required
        CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);

CREATE INDEX idx_users_role           ON users (role);
CREATE INDEX idx_users_status         ON users (status);
CREATE INDEX idx_users_linked_patient ON users (linked_patient_id);
CREATE INDEX idx_users_phone          ON users (phone_number) WHERE phone_number IS NOT NULL;
```

---

### 1.4 Table: auth_identities

```sql
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
```

---

### 1.5 Table: auth_sessions

```sql
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
```

---

### 1.6 Table: otp_challenges

```sql
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
```

---

### 1.7 Table: patients

```sql
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
    reminder_preferences    JSONB           NOT NULL DEFAULT '{"sms_enabled":true,"whatsapp_enabled":true,"timezone":"Asia/Kolkata"}',
    reminder_opt_out        BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Add deferred FK from users.linked_patient_id now that patients exists
ALTER TABLE users
    ADD CONSTRAINT fk_users_linked_patient
        FOREIGN KEY (linked_patient_id) REFERENCES patients (id) ON DELETE SET NULL;

CREATE INDEX idx_patients_max_id  ON patients (max_id);
CREATE INDEX idx_patients_name    ON patients (name);
CREATE INDEX idx_patients_phone   ON patients (phone_number) WHERE phone_number IS NOT NULL;
```

---

### 1.8 Table: doctor_patient_assignments

```sql
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
```

---

### 1.9 Table: follow_up_protocols

```sql
CREATE TABLE follow_up_protocols (
    id                              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                            TEXT    NOT NULL,
    diagnosis_match                 TEXT,   -- optional partial match string (e.g., 'DCLD')
    -- [{"day": 7, "title": "Post-op Day 7 checkpoint"}, {"day": 14, ...}, ...]
    post_op_checkpoints             JSONB   NOT NULL DEFAULT '[]',
    default_follow_up_interval_days INT     NOT NULL,
    active                          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fup_protocols_active ON follow_up_protocols (active);
```

---

### 1.10 Table: milestones

```sql
CREATE TABLE milestones (
    id                      UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id              UUID                NOT NULL
                                REFERENCES patients (id) ON DELETE CASCADE,
    type                    milestone_type      NOT NULL,
    title                   TEXT                NOT NULL,
    description             TEXT,
    due_date                DATE                NOT NULL,
    status                  milestone_status    NOT NULL DEFAULT 'scheduled',
    source                  milestone_source    NOT NULL,
    linked_follow_up_row_id UUID,               -- set when patient submits
    doctor_response_id      UUID,               -- set for doctor_ordered milestones
    created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);

CREATE INDEX idx_milestones_patient_id          ON milestones (patient_id);
CREATE INDEX idx_milestones_due_date            ON milestones (due_date);
CREATE INDEX idx_milestones_status              ON milestones (status);
CREATE INDEX idx_milestones_patient_status      ON milestones (patient_id, status);
CREATE INDEX idx_milestones_due_scheduled       ON milestones (due_date, status)
    WHERE status = 'scheduled';
```

---

### 1.11 Table: reminder_schedules

```sql
CREATE TABLE reminder_schedules (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    milestone_id    UUID                NOT NULL
                        REFERENCES milestones (id) ON DELETE CASCADE,
    reminder_type   reminder_type_enum  NOT NULL,
    offset_days     INT                 NOT NULL,   -- negative=before, 0=due day, positive=after
    scheduled_at    TIMESTAMPTZ         NOT NULL,   -- computed: due_date + offset_days, at 08:00 IST
    status          reminder_status     NOT NULL DEFAULT 'pending',
    sent_at         TIMESTAMPTZ,

    CONSTRAINT uq_reminder_milestone_type
        UNIQUE (milestone_id, reminder_type)        -- satisfies M-09: no duplicates
);

CREATE INDEX idx_reminder_schedules_milestone_id ON reminder_schedules (milestone_id);
CREATE INDEX idx_reminder_schedules_status       ON reminder_schedules (status);
CREATE INDEX idx_reminder_schedules_scheduled_at ON reminder_schedules (scheduled_at)
    WHERE status = 'pending';
```

---

### 1.12 Table: follow_up_rows

```sql
CREATE TABLE follow_up_rows (
    id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id              UUID            NOT NULL
                                REFERENCES patients (id) ON DELETE CASCADE,
    pp_date                 DATE            NOT NULL,
    status                  followup_status NOT NULL DEFAULT 'draft',
    -- { "hb": 10.2, "tlc": 5.4, "platelets": 180, "afp": 2.1, "bil_total": 0.9,
    --   "sgot": 45, "sgpt": 38, "alk_phos": 210, "ggt": 32, "alb": 3.8,
    --   "na": 136, "k": 4.2, "urea": 28, "creat": 0.6, "hba1c": 5.2 }
    lab_values              JSONB           NOT NULL DEFAULT '{}',
    -- { "everolimus": null, "tac_c0": 8.12 }
    drug_levels             JSONB           NOT NULL DEFAULT '{}',
    -- { "tac_cyclo": "2/2", "aza_mpa": "1/1", "wys": "5" }
    patient_reported_doses  JSONB           NOT NULL DEFAULT '{}',
    -- filled by doctor; same shape as patient_reported_doses
    doctor_prescribed_doses JSONB,
    weight_kg               NUMERIC(5,2),
    notes                   TEXT,
    submitted_at            TIMESTAMPTZ,
    reviewed_at             TIMESTAMPTZ,
    reviewed_by             UUID
                                REFERENCES users (id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_follow_up_rows_patient_pp_date
        UNIQUE (patient_id, pp_date)
);

CREATE INDEX idx_fur_patient_id         ON follow_up_rows (patient_id);
CREATE INDEX idx_fur_status             ON follow_up_rows (status);
CREATE INDEX idx_fur_patient_status     ON follow_up_rows (patient_id, status);
CREATE INDEX idx_fur_pp_date            ON follow_up_rows (pp_date);
CREATE INDEX idx_fur_submitted_at       ON follow_up_rows (submitted_at)
    WHERE submitted_at IS NOT NULL;
CREATE INDEX idx_fur_reviewed_by        ON follow_up_rows (reviewed_by)
    WHERE reviewed_by IS NOT NULL;
```

---

### 1.13 Table: attachments

```sql
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
```

---

### 1.14 Table: dose_changes

```sql
CREATE TABLE dose_changes (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    follow_up_row_id    UUID        NOT NULL
                            REFERENCES follow_up_rows (id) ON DELETE CASCADE,
    field_name          TEXT        NOT NULL,   -- e.g. 'tac_cyclo', 'aza_mpa', 'wys'
    old_value           TEXT,
    new_value           TEXT        NOT NULL,
    changed_by          UUID        NOT NULL
                            REFERENCES users (id) ON DELETE RESTRICT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason              TEXT
);

CREATE INDEX idx_dose_changes_follow_up_row_id ON dose_changes (follow_up_row_id);
CREATE INDEX idx_dose_changes_changed_by       ON dose_changes (changed_by);
CREATE INDEX idx_dose_changes_changed_at       ON dose_changes (changed_at);
```

---

### 1.15 Table: doctor_responses

```sql
CREATE TABLE doctor_responses (
    id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    follow_up_row_id            UUID        NOT NULL UNIQUE
                                    REFERENCES follow_up_rows (id) ON DELETE CASCADE,
    doctor_id                   UUID        NOT NULL
                                    REFERENCES users (id) ON DELETE RESTRICT,
    -- [{"code": "TAC_LEVEL", "description": "Repeat Tac/C0 in 7 days", "due_date": "2026-08-23"}]
    additional_tests            JSONB       NOT NULL DEFAULT '[]',
    additional_medications      TEXT,
    clinical_notes              TEXT,
    next_followup_interval_days INT,
    sent_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doctor_responses_follow_up_row_id ON doctor_responses (follow_up_row_id);
CREATE INDEX idx_doctor_responses_doctor_id        ON doctor_responses (doctor_id);
CREATE INDEX idx_doctor_responses_sent_at          ON doctor_responses (sent_at);
```

---

### 1.16 Table: notifications

```sql
CREATE TABLE notifications (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL
                    REFERENCES users (id) ON DELETE CASCADE,
    event_type  TEXT        NOT NULL,   -- e.g. 'FOLLOWUP_SUBMITTED', 'DOCTOR_RESPONDED'
    payload     JSONB       NOT NULL,   -- event-specific data (no raw PHI in message body)
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id         ON notifications (user_id);
CREATE INDEX idx_notifications_user_read       ON notifications (user_id, read_at)
    WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_at      ON notifications (created_at);
```

---

### 1.17 Triggers: updated_at maintenance

```sql
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

CREATE TRIGGER trg_follow_up_rows_updated_at
    BEFORE UPDATE ON follow_up_rows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```


---

## 2. Row-Level Security Policies

All PHI tables use PostgreSQL Row-Level Security. The application layer sets two session-local parameters before executing any query:

- `app.current_user_id` — UUID of the authenticated user
- `app.current_role` — role string: `'patient'`, `'caregiver'`, `'doctor'`, `'admin'`
- `app.current_patient_id` — UUID of the linked patient record (set only for patient/caregiver accounts)

The application DB role `postopcare_app` has no direct SELECT/INSERT/UPDATE/DELETE outside of these policies.

---

### 2.1 patients

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO postopcare_app;

-- Patient/caregiver: own row only
CREATE POLICY patients_patient_select ON patients
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND id = current_setting('app.current_patient_id')::UUID
    );

CREATE POLICY patients_patient_update ON patients
    FOR UPDATE TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND id = current_setting('app.current_patient_id')::UUID
    );

-- Doctor: only assigned patients
CREATE POLICY patients_doctor_select ON patients
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND id IN (
            SELECT patient_id
            FROM   doctor_patient_assignments
            WHERE  doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

-- Admin: full access
CREATE POLICY patients_admin_all ON patients
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.2 follow_up_rows

```sql
ALTER TABLE follow_up_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_rows FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON follow_up_rows TO postopcare_app;

CREATE POLICY fur_patient_select ON follow_up_rows
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND patient_id = current_setting('app.current_patient_id')::UUID
    );

CREATE POLICY fur_patient_insert ON follow_up_rows
    FOR INSERT TO postopcare_app
    WITH CHECK (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND patient_id = current_setting('app.current_patient_id')::UUID
    );

CREATE POLICY fur_patient_update ON follow_up_rows
    FOR UPDATE TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND patient_id = current_setting('app.current_patient_id')::UUID
        AND status = 'draft'    -- patients can only edit drafts
    );

CREATE POLICY fur_doctor_select ON follow_up_rows
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY fur_doctor_update ON follow_up_rows
    FOR UPDATE TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY fur_admin_all ON follow_up_rows
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.3 attachments

```sql
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO postopcare_app;

CREATE POLICY att_patient_select ON attachments
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = current_setting('app.current_patient_id')::UUID
        )
    );

CREATE POLICY att_patient_insert ON attachments
    FOR INSERT TO postopcare_app
    WITH CHECK (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = current_setting('app.current_patient_id')::UUID
        )
    );

CREATE POLICY att_doctor_select ON attachments
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY att_admin_all ON attachments
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.4 dose_changes

```sql
ALTER TABLE dose_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dose_changes FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON dose_changes TO postopcare_app;

CREATE POLICY dc_patient_select ON dose_changes
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = current_setting('app.current_patient_id')::UUID
        )
    );

CREATE POLICY dc_doctor_select ON dose_changes
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY dc_doctor_insert ON dose_changes
    FOR INSERT TO postopcare_app
    WITH CHECK (
        current_setting('app.current_role') = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY dc_admin_all ON dose_changes
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.5 doctor_responses

```sql
ALTER TABLE doctor_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_responses FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_responses TO postopcare_app;

CREATE POLICY dr_patient_select ON doctor_responses
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND follow_up_row_id IN (
            SELECT id FROM follow_up_rows
            WHERE  patient_id = current_setting('app.current_patient_id')::UUID
        )
    );

CREATE POLICY dr_doctor_select ON doctor_responses
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY dr_doctor_insert ON doctor_responses
    FOR INSERT TO postopcare_app
    WITH CHECK (
        current_setting('app.current_role') = 'doctor'
        AND doctor_id = current_setting('app.current_user_id')::UUID
        AND follow_up_row_id IN (
            SELECT fur.id FROM follow_up_rows fur
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = fur.patient_id
            WHERE  dpa.doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY dr_admin_all ON doctor_responses
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.6 milestones

```sql
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON milestones TO postopcare_app;

CREATE POLICY ms_patient_select ON milestones
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND patient_id = current_setting('app.current_patient_id')::UUID
    );

CREATE POLICY ms_doctor_select ON milestones
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY ms_doctor_insert ON milestones
    FOR INSERT TO postopcare_app
    WITH CHECK (
        current_setting('app.current_role') = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY ms_doctor_update ON milestones
    FOR UPDATE TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY ms_admin_all ON milestones
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.7 reminder_schedules

```sql
ALTER TABLE reminder_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_schedules FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_schedules TO postopcare_app;

CREATE POLICY rs_patient_select ON reminder_schedules
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') IN ('patient', 'caregiver')
        AND milestone_id IN (
            SELECT id FROM milestones
            WHERE  patient_id = current_setting('app.current_patient_id')::UUID
        )
    );

CREATE POLICY rs_doctor_all ON reminder_schedules
    FOR ALL TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND milestone_id IN (
            SELECT m.id FROM milestones m
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = m.patient_id
            WHERE  dpa.doctor_id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY rs_admin_all ON reminder_schedules
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.8 notifications

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO postopcare_app;

-- Each user sees only their own notifications
CREATE POLICY notif_owner_all ON notifications
    FOR ALL TO postopcare_app
    USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY notif_admin_all ON notifications
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```

---

### 2.9 doctor_patient_assignments

```sql
ALTER TABLE doctor_patient_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_patient_assignments FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_patient_assignments TO postopcare_app;

-- Doctor can see their own assignments
CREATE POLICY dpa_doctor_select ON doctor_patient_assignments
    FOR SELECT TO postopcare_app
    USING (
        current_setting('app.current_role') = 'doctor'
        AND doctor_id = current_setting('app.current_user_id')::UUID
    );

-- Admin manages all assignments
CREATE POLICY dpa_admin_all ON doctor_patient_assignments
    FOR ALL TO postopcare_app
    USING (current_setting('app.current_role') = 'admin');
```


---

## 3. API Contracts

All endpoints are served through AWS API Gateway (HTTP API). Every request (except auth callbacks) must include `Authorization: Bearer <sessionToken>` or a valid session cookie.

**Standard response envelope:**

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

Error envelope:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": {}
  }
}
```

---

### 3.1 Auth Endpoints

---

**POST** `/auth/google/callback`

- **Auth:** None (public)
- **Request body:**
```json
{ "code": "string", "state": "string", "redirect_uri": "string" }
```
- **Response 200:**
```json
{
  "sessionToken": "string",
  "expiresAt": "2026-09-15T00:00:00Z",
  "user": { "id": "uuid", "role": "doctor", "displayName": "Dr. Rajesh Dey" }
}
```
- **Errors:** `400` invalid state/CSRF; `401` ID token validation failed; `409` identity already linked to another user; `503` Google unreachable
- **Validation:** state must match value in Redis (CSRF check); code is single-use; redirect_uri must match registered URI

---

**POST** `/auth/x/callback`

- **Auth:** None (public)
- **Request body:**
```json
{ "code": "string", "state": "string", "code_verifier": "string" }
```
- **Response 200:** same shape as `/auth/google/callback`
- **Errors:** `400` invalid state; `401` token exchange failed; `409` identity conflict; `503` X API unreachable
- **Validation:** PKCE code_verifier verified against code_challenge stored in Redis; state CSRF check

---

**POST** `/auth/otp/send`

- **Auth:** None (public)
- **Request body:**
```json
{ "phone_number": "+919876543210" }
```
- **Response 200:**
```json
{ "challengeId": "uuid", "expiresAt": "2026-08-16T10:15:00Z", "resendAfterSeconds": 60 }
```
- **Errors:** `400` invalid E.164 format; `429` rate limit exceeded (3 OTP requests per number per hour)
- **Validation:** E.164 regex; rate-limit counter in Redis keyed by `otp_rate:{phone}` with 1h TTL; max 3 sends/hour

---

**POST** `/auth/otp/verify`

- **Auth:** None (public)
- **Request body:**
```json
{ "challengeId": "uuid", "otp": "123456" }
```
- **Response 200:** same shape as `/auth/google/callback`
- **Errors:** `400` expired challenge; `401` invalid OTP; `429` max attempts exceeded (5 attempts → challenge invalidated)
- **Validation:** bcrypt compare otp against otp_challenges.otp_hash; increment attempts on failure; mark verified_at on success

---

**DELETE** `/auth/session`

- **Auth:** Any authenticated role
- **Request:** No body; uses Authorization header to identify session
- **Response 204:** No content
- **Errors:** `401` already expired or revoked
- **Validation:** Sets revoked_at in auth_sessions; deletes session key from Redis

---

**GET** `/auth/me`

- **Auth:** Any authenticated role
- **Response 200:**
```json
{
  "id": "uuid",
  "role": "patient",
  "displayName": "Caregiver Name",
  "email": "user@example.com",
  "status": "active",
  "linkedPatientId": "uuid"
}
```
- **Errors:** `401` invalid session

---

### 3.2 Patient Endpoints

---

**GET** `/patients/:id`

- **Auth:** `patient`, `caregiver` (own only), `doctor` (assigned), `admin`
- **Response 200:**
```json
{
  "id": "uuid",
  "name": "Raghavendra S. Dyk",
  "ageYears": 4.5,
  "sex": "M",
  "maxId": "SHMS.750590",
  "photoUrl": "https://cdn.postopcare.in/photos/...",
  "dateOfOperation": "2026-05-26",
  "diagnosis": "DCLD - ? AIH",
  "histopathology": "Biliary Cirrhosis (PBC)",
  "anastomosisType": "Free text",
  "contactEmail": "caregiver@example.com",
  "phoneNumber": "+919876543210",
  "whatsappNumber": "+919876543210",
  "reminderPreferences": { "sms_enabled": true, "whatsapp_enabled": true, "timezone": "Asia/Kolkata" },
  "reminderOptOut": false
}
```
- **Errors:** `403` not assigned; `404` patient not found

---

**PUT** `/patients/:id`

- **Auth:** `patient`, `caregiver` (own non-clinical fields); `doctor`, `admin` (all fields)
- **Request body (partial update):**
```json
{
  "phoneNumber": "+919876543210",
  "whatsappNumber": "+919876543210",
  "reminderPreferences": { "sms_enabled": true, "whatsapp_enabled": false, "timezone": "Asia/Kolkata" },
  "reminderOptOut": false
}
```
- **Response 200:** Updated patient object (same shape as GET)
- **Errors:** `400` invalid timezone; `403` patient attempting to update clinical fields (diagnosis, histopathology); `404` not found
- **Validation:** timezone must be a valid IANA string; phone in E.164 format; sex in `['M','F','O']`

---

**GET** `/patients/:id/chart-header`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Response 200:**
```json
{
  "name": "Raghavendra S. Dyk",
  "ageYears": 4.5,
  "sex": "M",
  "maxId": "SHMS.750590",
  "dateOfOperation": "2026-05-26",
  "diagnosis": "DCLD - ? AIH",
  "histopathology": "Biliary Cirrhosis (PBC)",
  "anastomosisType": "Free text",
  "assignedDoctors": [
    { "id": "uuid", "displayName": "Dr. Rajesh Dey" }
  ]
}
```
- **Errors:** `403` unauthorized; `404` not found

---

### 3.3 Follow-Up Endpoints

---

**GET** `/followup/rows`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Query params:** `patientId` (required for doctor/admin), `status` (draft|pending|reviewed), `page` (default 1), `pageSize` (default 20, max 100)
- **Response 200:**
```json
{
  "rows": [
    {
      "id": "uuid",
      "patientId": "uuid",
      "ppDate": "2026-08-16",
      "status": "pending",
      "labValues": { "hb": 10.2, "bilTotal": 0.9 },
      "drugLevels": { "tacC0": 8.12 },
      "patientReportedDoses": { "tacCyclo": "2/2", "azaMpa": "1/1", "wys": "5" },
      "doctorPrescribedDoses": null,
      "weightKg": 5.4,
      "submittedAt": "2026-08-16T10:42:00Z",
      "reviewedAt": null
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 12 }
}
```
- **Errors:** `400` missing patientId for doctor role; `403` not assigned

---

**POST** `/followup/rows`

- **Auth:** `patient`, `caregiver`
- **Request body:**
```json
{
  "patientId": "uuid",
  "ppDate": "2026-08-16",
  "labValues": { "hb": 10.2, "tlc": 5.4, "bilTotal": 0.9, "sgot": 45, "sgpt": 38 },
  "drugLevels": { "tacC0": 8.12, "everolimus": null },
  "patientReportedDoses": { "tacCyclo": "2/2", "azaMpa": "1/1", "wys": "5" },
  "weightKg": 5.4,
  "notes": "Fasting sample at 7am"
}
```
- **Response 201:**
```json
{ "id": "uuid", "status": "draft", "createdAt": "2026-08-16T10:30:00Z" }
```
- **Errors:** `400` duplicate pp_date for patient; `403` patientId doesn't match linked patient
- **Validation:** ppDate required and not in future by more than 1 day; numeric lab fields must be non-negative; patientId must equal current_patient_id for patient/caregiver

---

**GET** `/followup/rows/:id`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Response 200:** Full row object including `attachments[]`, `doseChanges[]`, `doctorResponse`
- **Errors:** `403` not authorized; `404` not found

---

**PUT** `/followup/rows/:id/submit`

- **Auth:** `patient`, `caregiver`
- **Request:** No body (submission is idempotent transition: draft → pending)
- **Response 200:**
```json
{ "id": "uuid", "status": "pending", "submittedAt": "2026-08-16T10:42:00Z" }
```
- **Errors:** `400` row is missing required fields (ppDate, at least one lab value); `409` already submitted or reviewed
- **Validation:** status must be `draft`; publishes `FOLLOWUP_SUBMITTED` event to SQS; cancels pending reminder_schedules for linked milestone

---

**POST** `/followup/rows/:id/attachments/presign`

- **Auth:** `patient`, `caregiver`
- **Request body:**
```json
{ "filename": "lab_report_16aug.pdf", "mimeType": "application/pdf", "fileSizeBytes": 204800 }
```
- **Response 201:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/postopcare-lab-reports-...?X-Amz-Signature=...",
  "objectKey": "patients/{patientId}/rows/{rowId}/{uuid}.pdf",
  "expiresAt": "2026-08-16T11:00:00Z"
}
```
- **Errors:** `400` unsupported MIME type; `413` file size > 20MB; `403` row is already reviewed
- **Validation:** allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`; max size 20MB

---

**POST** `/followup/rows/:id/attachments/confirm`

- **Auth:** `patient`, `caregiver`
- **Request body:**
```json
{ "objectKey": "patients/.../uuid.pdf", "filename": "lab_report_16aug.pdf" }
```
- **Response 201:**
```json
{ "attachmentId": "uuid", "scanStatus": "pending" }
```
- **Errors:** `400` objectKey doesn't match presigned key; `404` object not found in S3
- **Validation:** verify object exists in S3 (HeadObject); write attachment record; S3 event will trigger virus scan Lambda

---

### 3.4 Dose Endpoints

---

**PUT** `/followup/rows/:id/response`

- **Auth:** `doctor`
- **Request body:**
```json
{
  "doctorPrescribedDoses": { "tacCyclo": "2/2", "azaMpa": "1/0", "wys": "5" },
  "additionalTests": [
    { "code": "TAC_LEVEL", "description": "Repeat Tac/C0 in 7 days", "dueDate": "2026-08-23" }
  ],
  "additionalMedications": "Continue current regimen",
  "clinicalNotes": "Tac level improved. Reduce Aza evening dose.",
  "nextFollowupIntervalDays": 14
}
```
- **Response 200:**
```json
{
  "responseId": "uuid",
  "doseChanges": [
    { "fieldName": "azaMpa", "oldValue": "1/1", "newValue": "1/0", "changedAt": "2026-08-17T09:15:00Z" }
  ],
  "nextMilestoneId": "uuid",
  "nextMilestoneDueDate": "2026-08-31"
}
```
- **Errors:** `403` not assigned to patient; `409` response already submitted for this row
- **Validation:** nextFollowupIntervalDays must be between 1–180; dose fields must match known keys; records dose_changes for any field that differs from patient_reported_doses

---

**GET** `/followup/rows/:id/dose-history`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Response 200:**
```json
{
  "doseChanges": [
    {
      "id": "uuid",
      "fieldName": "tacCyclo",
      "oldValue": "4/4",
      "newValue": "2/2",
      "changedBy": { "id": "uuid", "displayName": "Dr. Rajesh Dey" },
      "changedAt": "2026-06-30T09:00:00Z",
      "reason": null
    }
  ]
}
```
- **Errors:** `403` unauthorized; `404` row not found

---

### 3.5 Milestone Endpoints

---

**GET** `/milestones`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Query params:** `patientId` (required for doctor/admin), `status` (scheduled|completed|cancelled|overdue), `from` (ISO date), `to` (ISO date)
- **Response 200:**
```json
{
  "milestones": [
    {
      "id": "uuid",
      "patientId": "uuid",
      "type": "follow_up",
      "title": "Follow-up submission due",
      "dueDate": "2026-08-20",
      "status": "scheduled",
      "source": "system",
      "linkedFollowUpRowId": null,
      "createdAt": "2026-08-17T09:15:00Z"
    }
  ]
}
```

---

**POST** `/milestones`

- **Auth:** `doctor`, `admin`
- **Request body:**
```json
{
  "patientId": "uuid",
  "type": "doctor_ordered",
  "title": "Repeat Tac/C0 level",
  "description": "Draw at trough (12h post last dose)",
  "dueDate": "2026-08-23",
  "source": "doctor"
}
```
- **Response 201:**
```json
{ "id": "uuid", "reminderSchedules": [ { "type": "advance", "scheduledAt": "2026-08-21T02:30:00Z" } ] }
```
- **Errors:** `400` dueDate in past; `403` not assigned to patient

---

**PUT** `/milestones/:id`

- **Auth:** `doctor`, `admin`
- **Request body (partial):**
```json
{ "dueDate": "2026-08-25", "status": "cancelled", "title": "Updated title" }
```
- **Response 200:** Updated milestone object
- **Errors:** `400` invalid status transition; `403` unauthorized; `404` not found
- **Validation:** status can only move: `scheduled → cancelled`, `scheduled → overdue`, `scheduled → completed`

---

**GET** `/milestones/:id/reminders`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Response 200:**
```json
{
  "milestoneId": "uuid",
  "reminders": [
    {
      "id": "uuid",
      "reminderType": "advance",
      "scheduledAt": "2026-08-18T02:30:00Z",
      "status": "sent",
      "sentAt": "2026-08-18T02:30:05Z"
    }
  ]
}
```

---

### 3.6 Notification Endpoints

---

**GET** `/notifications`

- **Auth:** Any authenticated role
- **Query params:** `unreadOnly` (boolean, default false), `page`, `pageSize`
- **Response 200:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "eventType": "DOCTOR_RESPONDED",
      "payload": { "rowId": "uuid", "ppDate": "2026-08-16", "doctorName": "Dr. Rajesh Dey" },
      "readAt": null,
      "createdAt": "2026-08-17T09:15:00Z"
    }
  ],
  "unreadCount": 2
}
```

---

**PUT** `/notifications/:id/read`

- **Auth:** Any authenticated role (own notification only)
- **Response 200:** `{ "id": "uuid", "readAt": "2026-08-17T10:00:00Z" }`
- **Errors:** `403` not own notification; `404` not found

---

**PUT** `/notifications/read-all`

- **Auth:** Any authenticated role
- **Response 200:** `{ "updatedCount": 5 }`

---

**GET** `/notifications/preferences`

- **Auth:** `patient`, `caregiver`
- **Response 200:**
```json
{
  "smsEnabled": true,
  "whatsappEnabled": true,
  "emailEnabled": true,
  "inAppEnabled": true,
  "reminderOptOut": false,
  "timezone": "Asia/Kolkata"
}
```

---

**PUT** `/notifications/preferences`

- **Auth:** `patient`, `caregiver`
- **Request body:**
```json
{ "smsEnabled": true, "whatsappEnabled": false, "reminderOptOut": false }
```
- **Response 200:** Updated preferences object
- **Errors:** `400` invalid timezone string

---

### 3.7 Export Endpoints

---

**POST** `/export/chart/:patientId`

- **Auth:** `patient`, `caregiver`, `doctor`, `admin`
- **Request body (optional):**
```json
{ "fromDate": "2026-01-01", "toDate": "2026-08-16", "includeDoseHistory": true }
```
- **Response 202:**
```json
{ "exportId": "uuid", "status": "processing", "estimatedReadyInSeconds": 15 }
```
- **Errors:** `403` unauthorized; `404` patient not found

---

**GET** `/export/:exportId/download`

- **Auth:** Same user who requested export
- **Response 200:**
```json
{ "downloadUrl": "https://s3.amazonaws.com/postopcare-exports-...?X-Amz-Signature=...", "expiresAt": "2026-08-17T10:00:00Z" }
```
- **Errors:** `202` still processing; `404` export not found; `410` export expired (> 24h)

---

### 3.8 Admin Endpoints

---

**POST** `/admin/patients`

- **Auth:** `admin`
- **Request body:**
```json
{
  "name": "Raghavendra S. Dyk",
  "ageYears": 4.5,
  "sex": "M",
  "maxId": "SHMS.750590",
  "dateOfOperation": "2026-05-26",
  "diagnosis": "DCLD - ? AIH",
  "histopathology": "Biliary Cirrhosis (PBC)",
  "anastomosisType": "Free text",
  "contactEmail": "caregiver@example.com",
  "phoneNumber": "+919876543210",
  "assignedDoctorIds": ["uuid-doctor-1"],
  "protocolId": "uuid-protocol"
}
```
- **Response 201:** `{ "patientId": "uuid", "milestonesGenerated": 4 }`
- **Errors:** `400` duplicate maxId; `404` doctorId not found; `422` protocolId inactive

---

**GET** `/admin/patients`

- **Auth:** `admin`
- **Query params:** `search` (name or maxId), `page`, `pageSize`
- **Response 200:** Paginated list of patient summaries

---

**POST** `/admin/invites`

- **Auth:** `admin`
- **Request body:**
```json
{ "email": "caregiver@example.com", "phone": "+919876543210", "role": "caregiver", "patientId": "uuid" }
```
- **Response 201:** `{ "inviteId": "uuid", "expiresAt": "2026-08-23T00:00:00Z" }`
- **Errors:** `400` neither email nor phone provided; `404` patientId not found

---

**GET** `/admin/users`

- **Auth:** `admin`
- **Query params:** `role`, `status`, `page`, `pageSize`
- **Response 200:** Paginated list of user records

---

**PUT** `/admin/users/:id/role`

- **Auth:** `admin`
- **Request body:** `{ "role": "doctor", "status": "active" }`
- **Response 200:** Updated user object
- **Errors:** `400` invalid role; `404` user not found

---

**GET** `/admin/protocols`

- **Auth:** `admin`
- **Response 200:**
```json
{
  "protocols": [
    {
      "id": "uuid",
      "name": "Standard Liver Transplant Protocol",
      "diagnosisMatch": "DCLD",
      "postOpCheckpoints": [
        { "day": 7, "title": "Post-op Day 7 checkpoint" },
        { "day": 14, "title": "Post-op Day 14 checkpoint" },
        { "day": 30, "title": "Post-op Day 30 checkpoint" },
        { "day": 90, "title": "Post-op Day 90 checkpoint" }
      ],
      "defaultFollowUpIntervalDays": 14,
      "active": true
    }
  ]
}
```

---

**POST** `/admin/protocols`

- **Auth:** `admin`
- **Request body:** Protocol object (same shape as above, without `id` and `active`)
- **Response 201:** `{ "id": "uuid" }`
- **Errors:** `400` missing required fields; `422` duplicate name

---

### 3.9 WebSocket Routes (API Gateway WebSocket API)

---

**`$connect`**

- **Auth:** `?token=<sessionToken>` query parameter validated by Lambda authorizer
- **On success:** Store `connectionId → userId` in Redis key `ws:conn:{connectionId}` (TTL 24h); store `ws:user:{userId}` → `connectionId` (TTL 24h)
- **On failure:** Return 401 to reject the connection

---

**`$disconnect`**

- **Auth:** Implicit (connection already established)
- **On disconnect:** Delete `ws:conn:{connectionId}` and `ws:user:{userId}` from Redis


---

## 4. Lambda Function Designs

All Lambda functions run in the private VPC subnets (ap-south-1a, ap-south-1b) unless noted. VPC attachment adds ~few ms but is required for RDS Proxy and Redis access.

---

### 4.1 auth Lambda

**Handler:** `src/handlers/auth.handler`  
**Runtime:** Node.js 22  **Memory:** 512 MB  **Timeout:** 10s  **VPC:** Yes

**Environment variables:**

| Key | Value source |
|-----|-------------|
| `GOOGLE_CLIENT_ID` | Secrets Manager |
| `GOOGLE_CLIENT_SECRET` | Secrets Manager |
| `X_CLIENT_ID` | Secrets Manager |
| `X_CLIENT_SECRET` | Secrets Manager |
| `JWT_SIGNING_KEY` | Secrets Manager |
| `SESSION_TTL_SECONDS` | SSM Parameter (2592000 = 30d) |
| `OTP_TTL_SECONDS` | SSM Parameter (300 = 5min) |
| `OTP_MAX_ATTEMPTS` | SSM Parameter (5) |
| `REDIS_URL` | SSM Parameter |
| `DB_PROXY_ENDPOINT` | SSM Parameter |
| `SMS_GATEWAY_URL` | SSM Parameter |
| `SMS_API_KEY` | Secrets Manager |

**IAM permissions:**

```
secretsmanager:GetSecretValue  (auth secrets ARNs)
ssm:GetParameter               (config params)
rds-db:connect                 (RDS Proxy IAM auth)
```

**Pseudocode — Google/X callback:**

```
1.  Parse event: extract route (google|x), code, state, code_verifier
2.  Validate CSRF: GET Redis key oauth_state:{state} → must exist and not expired
3.  DELETE Redis key oauth_state:{state}
4.  Exchange code for tokens via Google tokeninfo / X token endpoint
5.  Validate ID token (issuer, audience, expiry, signature)
6.  Extract provider_subject, email, display_name from token/userinfo
7.  BEGIN DB transaction
8.  SELECT auth_identities WHERE provider=? AND provider_subject=?
    → If found: load user, update last_login_at
    → If not found: check invite/allowlist; create user + auth_identity
9.  COMMIT transaction
10. Issue session: generate UUID token; SET Redis session:{token} → {userId, role} TTL; INSERT auth_sessions
11. Return 200 { sessionToken, expiresAt, user }
```

**Pseudocode — OTP send:**

```
1.  Parse phone_number; validate E.164 format
2.  Check Redis otp_rate:{phone} counter; reject if >= 3 (429)
3.  Generate 6-digit OTP; bcrypt hash it
4.  INSERT otp_challenges (phone_number, otp_hash, expires_at=now+5min)
5.  INCR Redis otp_rate:{phone}; EXPIRE to 3600s
6.  Build SMS message: "PostOp Care: {OTP} is your verification code. Valid for 5 minutes."
7.  POST to SMS gateway API (MSG91/Twilio)
8.  Log audit event to DynamoDB audit_auth table
9.  Return 200 { challengeId, expiresAt, resendAfterSeconds: 60 }
10. (No OTP value in response)
```

---

### 4.2 patient Lambda

**Handler:** `src/handlers/patient.handler`  
**Runtime:** Node.js 22  **Memory:** 256 MB  **Timeout:** 5s  **VPC:** Yes

**Environment variables:** `DB_PROXY_ENDPOINT`, `REDIS_URL`, `S3_ASSETS_BUCKET`, `CDN_BASE_URL`

**IAM permissions:**

```
rds-db:connect
s3:GetObject       (postopcare-assets bucket — for signed photo URLs)
ssm:GetParameter
```

**Pseudocode — GET /patients/:id:**

```
1.  Extract patientId from path; userId/role from JWT context
2.  Set PostgreSQL session variables: app.current_user_id, app.current_role, app.current_patient_id
3.  SELECT * FROM patients WHERE id = :patientId  (RLS enforces access)
4.  If not found: return 404
5.  If photo_url is an S3 key: generate presigned GET URL (1h TTL) via CloudFront signed URL
6.  Fetch assigned doctors: SELECT u.id, u.display_name FROM users u JOIN doctor_patient_assignments dpa ON dpa.doctor_id = u.id WHERE dpa.patient_id = :patientId
7.  Merge doctor list into response
8.  Strip internal fields (created_at noise, etc.)
9.  Return 200 with patient DTO
10. Cache result in Redis patient:{patientId} TTL 300s
```

**Pseudocode — PUT /patients/:id:**

```
1.  Extract patientId, body; validate schema with Zod
2.  Set PG session variables; verify role-based field restrictions
3.  Patients/caregivers may only update: phone_number, whatsapp_number, reminder_preferences, reminder_opt_out
4.  Doctors/admins may update all fields including clinical data
5.  Build UPDATE SET clause from allowed fields only (whitelist approach)
6.  UPDATE patients SET ... WHERE id = :patientId (RLS applies)
7.  Invalidate Redis cache: DEL patient:{patientId}
8.  Log mutation to CloudWatch structured log
9.  Return 200 updated patient DTO
10. Publish PATIENT_UPDATED event if clinical fields changed (for audit log)
```

---

### 4.3 followup Lambda

**Handler:** `src/handlers/followup.handler`  
**Runtime:** Node.js 22  **Memory:** 512 MB  **Timeout:** 15s  **VPC:** Yes

**Environment variables:** `DB_PROXY_ENDPOINT`, `REDIS_URL`, `S3_LAB_REPORTS_BUCKET`, `PRESIGN_TTL_SECONDS`, `NOTIFICATION_QUEUE_URL`

**IAM permissions:**

```
rds-db:connect
s3:PutObject         (presign upload)
s3:GetObject         (confirm step — HeadObject check)
s3:HeadObject
sqs:SendMessage      (notification-dispatcher queue)
ssm:GetParameter
```

**Pseudocode — POST /followup/rows (create draft):**

```
1.  Validate request body with Zod schema; ensure patientId = current_patient_id
2.  Set PG session variables
3.  Check no existing draft for same (patient_id, pp_date) — return 400 if duplicate
4.  BEGIN transaction
5.  INSERT follow_up_rows (status=draft, lab_values, drug_levels, patient_reported_doses, weight_kg, notes)
6.  COMMIT transaction
7.  Return 201 { id, status: 'draft', createdAt }
8.  (Draft does NOT trigger notifications)
9.  Set Redis follow_up_draft:{patientId} → rowId (soft cache for UI autosave)
10. Return response
```

**Pseudocode — PUT /followup/rows/:id/submit:**

```
1.  Load follow_up_row by id; verify status='draft'
2.  Validate completeness: ppDate required; at least one lab_value key present
3.  BEGIN transaction
4.  UPDATE follow_up_rows SET status='pending', submitted_at=NOW() WHERE id=:id
5.  Find linked milestone for this patient: SELECT id FROM milestones WHERE patient_id=:patientId AND status='scheduled' AND type='follow_up' ORDER BY due_date ASC LIMIT 1
6.  If milestone found: UPDATE milestones SET linked_follow_up_row_id=:rowId; UPDATE reminder_schedules SET status='cancelled' WHERE milestone_id=:milestoneId AND status='pending'
7.  COMMIT transaction
8.  Publish FollowUpSubmitted message to SQS notification-dispatcher queue
9.  Return 200 { id, status: 'pending', submittedAt }
10. Invalidate Redis patient dashboard cache
```

**Pseudocode — POST /followup/rows/:id/attachments/presign:**

```
1.  Validate MIME type in allowlist; validate file size <= 20MB
2.  Generate objectKey: patients/{patientId}/rows/{rowId}/{uuid}.{ext}
3.  Generate S3 presigned PUT URL (TTL = PRESIGN_TTL_SECONDS, default 900s)
4.  Store pending upload intent in Redis presign:{objectKey} → { rowId, uploadedBy } TTL 1800s
5.  Return 201 { uploadUrl, objectKey, expiresAt }
6.  (Attachment record not created yet — created on /confirm)
7.  (Log presign request to CloudWatch)
8.  Ensure Content-Type condition set in presigned URL policy
9.  Ensure Content-Length-Range condition: 1 to maxBytes
10. Return response
```

---

### 4.4 dose Lambda

**Handler:** `src/handlers/dose.handler`  
**Runtime:** Node.js 22  **Memory:** 256 MB  **Timeout:** 10s  **VPC:** Yes

**Environment variables:** `DB_PROXY_ENDPOINT`, `REDIS_URL`, `NOTIFICATION_QUEUE_URL`

**IAM permissions:** `rds-db:connect`, `sqs:SendMessage`

**Pseudocode — PUT /followup/rows/:id/response:**

```
1.  Validate body with Zod; verify doctor is assigned to patient
2.  Load follow_up_row; verify status='pending'
3.  Check no existing doctor_response for this row (unique constraint guard)
4.  BEGIN transaction
5.  Diff doctor_prescribed_doses vs patient_reported_doses; INSERT dose_changes rows for each changed field (old_value, new_value, changed_by=doctorId, changed_at=NOW())
6.  UPDATE follow_up_rows SET doctor_prescribed_doses=:doses, status='reviewed', reviewed_at=NOW(), reviewed_by=:doctorId
7.  INSERT doctor_responses (follow_up_row_id, doctor_id, additional_tests, additional_medications, clinical_notes, next_followup_interval_days)
8.  If next_followup_interval_days: compute nextDueDate = reviewedAt + interval; INSERT milestone (type=follow_up, source=system); INSERT reminder_schedules for advance/due_day/overdue/final_overdue types
9.  If additional_tests with dueDate: INSERT milestone (type=doctor_ordered, source=doctor) per test with due date
10. COMMIT; publish DoctorResponded event to SQS; return 200 { responseId, doseChanges, nextMilestoneId }
```

---

### 4.5 milestone Lambda

**Handler:** `src/handlers/milestone.handler`  
**Runtime:** Node.js 22  **Memory:** 256 MB  **Timeout:** 5s  **VPC:** Yes

**Environment variables:** `DB_PROXY_ENDPOINT`, `REDIS_URL`

**IAM permissions:** `rds-db:connect`

**Pseudocode — GET /milestones:**

```
1.  Extract patientId from query (doctor/admin) or from JWT context (patient)
2.  Set PG session variables; validate assignment
3.  Build query: SELECT * FROM milestones WHERE patient_id=:patientId
4.  Apply optional filters: status, from/to date range
5.  ORDER BY due_date ASC
6.  For each milestone: load reminder_schedules via JOIN
7.  Return paginated list
8.  Cache result in Redis milestones:{patientId}:{statusFilter} TTL 60s
9.  Return 200 { milestones }
10. (No PHI in cached value that isn't already scoped to patientId)
```

**Pseudocode — POST /milestones (doctor creates custom):**

```
1.  Validate body; verify dueDate is not in past
2.  Verify doctor is assigned to patientId
3.  BEGIN transaction
4.  INSERT milestone (type, title, description, due_date, status=scheduled, source=doctor)
5.  Compute reminder datetimes in patient timezone (Asia/Kolkata):
    advance:       dueDate - 2 days at 08:00 IST
    due_day:       dueDate at 08:00 IST
    overdue:       dueDate + 1 day at 08:00 IST
    final_overdue: dueDate + 3 days at 08:00 IST
6.  INSERT reminder_schedules (one row per reminder type, with computed scheduledAt)
7.  COMMIT
8.  Invalidate Redis milestones cache for patient
9.  Return 201 { id, reminderSchedules }
10. Log milestone creation to CloudWatch
```

---

### 4.6 milestone-evaluator Lambda

**Handler:** `src/handlers/milestoneEvaluator.handler`  
**Runtime:** Node.js 22  **Memory:** 512 MB  **Timeout:** 300s  **VPC:** Yes  
**Trigger:** EventBridge Scheduler — two rules: `cron(30 2 * * ? *)` (daily 08:00 IST) and `cron(30 * * * ? *)` (hourly)

**Environment variables:** `DB_PROXY_ENDPOINT`, `SMS_QUEUE_URL`, `WHATSAPP_QUEUE_URL`, `DEFAULT_TIMEZONE`

**IAM permissions:** `rds-db:connect`, `sqs:SendMessage`

**Pseudocode:**

```
1.  Determine evaluation window: scheduledAt BETWEEN NOW() AND NOW() + 2h (hourly) or NOW() + 48h (daily)
2.  Query due reminders:
    SELECT rs.*, m.patient_id, m.title, m.due_date, p.phone_number, p.whatsapp_number, p.reminder_preferences, p.reminder_opt_out
    FROM   reminder_schedules rs
    JOIN   milestones m ON m.id = rs.milestone_id
    JOIN   patients p ON p.id = m.patient_id
    WHERE  rs.status = 'pending'
      AND  rs.scheduled_at <= :windowEnd
      AND  m.status = 'scheduled'
      AND  p.reminder_opt_out = FALSE
3.  For each reminder: check patient reminder_preferences.sms_enabled / whatsapp_enabled
4.  If sms_enabled AND phone_number: publish to notification-sms FIFO queue (deduplicationId = reminderId + 'sms')
5.  If whatsapp_enabled AND whatsapp_number: publish to notification-whatsapp FIFO queue (deduplicationId = reminderId + 'wa')
6.  UPDATE reminder_schedules SET status='sent', sent_at=NOW() WHERE id IN (:sentIds)
7.  Detect overdue milestones: SELECT * FROM milestones WHERE status='scheduled' AND due_date < CURRENT_DATE
8.  For overdue milestones: UPDATE milestones SET status='overdue'; enqueue overdue/final_overdue reminders if not yet sent
9.  Log summary: total evaluated, total queued, total overdue
10. Return success
```

---

### 4.7 notification-dispatcher Lambda

**Handler:** `src/handlers/notificationDispatcher.handler`  
**Runtime:** Node.js 22  **Memory:** 256 MB  **Timeout:** 30s  **VPC:** Yes  
**Trigger:** SQS (internal notification-events queue)

**Environment variables:** `DB_PROXY_ENDPOINT`, `INAPP_QUEUE_URL`, `EMAIL_QUEUE_URL`, `SMS_QUEUE_URL`, `WHATSAPP_QUEUE_URL`

**IAM permissions:** `rds-db:connect`, `sqs:SendMessage`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`

**Pseudocode:**

```
1.  Receive SQS batch (up to 10 messages)
2.  For each message: parse event { eventType, payload }
3.  Determine target users based on eventType:
    FOLLOWUP_SUBMITTED → assigned doctors of patient
    DOCTOR_RESPONDED   → patient's linked user accounts
    MILESTONE_OVERDUE  → patient + assigned doctors (if Phase 2 escalation)
4.  Load notification preferences for each target user
5.  For each target user: INSERT notifications row (for in-app)
6.  Enqueue to notification-inapp.fifo if in-app enabled
7.  Enqueue to notification-email.fifo if email enabled
8.  Enqueue to notification-sms.fifo if sms enabled and event type warrants SMS
9.  Enqueue to notification-whatsapp.fifo if whatsapp enabled and event type warrants WhatsApp
10. Delete processed SQS message(s)
```

---

### 4.8 sms-sender Lambda

**Handler:** `src/handlers/smsSender.handler`  
**Runtime:** Node.js 22  **Memory:** 128 MB  **Timeout:** 30s  **VPC:** Yes  
**Trigger:** SQS FIFO `notification-sms.fifo` (batch size 1)

**Environment variables:** `SMS_GATEWAY_URL`, `SMS_API_KEY`, `DYNAMO_DELIVERY_TABLE`

**IAM permissions:** `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `dynamodb:PutItem`, `secretsmanager:GetSecretValue`

**Pseudocode:**

```
1.  Receive SQS message: { reminderId, recipientPhone, messageTemplate, templateParams }
2.  Render message text from template (no PHI — only date, app name, deep link)
3.  POST to SMS gateway API (MSG91/Twilio) with recipient, message, DLT template ID
4.  On HTTP 200/202: record providerMessageId
5.  Write DynamoDB reminder_delivery: { pk: reminderId#sms, channel: 'sms', recipientPhone, deliveryStatus: 'sent', providerMessageId, sentAt }
6.  Delete SQS message (acknowledge success)
7.  On HTTP 4xx (permanent): write deliveryStatus='failed', failureReason; delete SQS message (don't retry — permanent failure)
8.  On HTTP 5xx (transient): throw error → SQS retries (up to maxReceiveCount=3)
9.  On DLQ arrival: write deliveryStatus='failed', failureReason='dlq'; publish CloudWatch alarm
10. Return success
```

---

### 4.9 whatsapp-sender Lambda

**Handler:** `src/handlers/whatsappSender.handler`  
**Runtime:** Node.js 22  **Memory:** 128 MB  **Timeout:** 30s  **VPC:** Yes  
**Trigger:** SQS FIFO `notification-whatsapp.fifo` (batch size 1)

**Environment variables:** `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `DYNAMO_DELIVERY_TABLE`

**IAM permissions:** `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `dynamodb:PutItem`, `secretsmanager:GetSecretValue`

**Pseudocode:**

```
1.  Receive SQS message: { reminderId, recipientPhone, templateName, templateLanguage, templateComponents }
2.  Validate templateName is in approved template list (loaded from SSM on cold start)
3.  Build Meta Cloud API request body: { messaging_product: "whatsapp", to: recipientPhone, type: "template", template: { name, language, components } }
4.  POST to https://graph.facebook.com/v19.0/{phoneNumberId}/messages with Bearer token
5.  On 200: extract messages[0].id as providerMessageId
6.  Write DynamoDB: { pk: reminderId#whatsapp, channel: 'whatsapp', deliveryStatus: 'sent', providerMessageId }
7.  Delete SQS message
8.  On 400 (template not approved / invalid number): write deliveryStatus='failed'; delete SQS message (no retry)
9.  On 500/timeout: throw → SQS retries up to maxReceiveCount=3
10. Delivery receipt updates (delivered/read) arrive via Meta webhook → separate tiny Lambda updates DynamoDB status
```

---

### 4.10 email-sender Lambda

**Handler:** `src/handlers/emailSender.handler`  
**Runtime:** Node.js 22  **Memory:** 128 MB  **Timeout:** 30s  **VPC:** No (SES is public endpoint)  
**Trigger:** SQS FIFO `notification-email.fifo` (batch size 10)

**Environment variables:** `SES_FROM_ADDRESS`, `SES_REGION`, `APP_BASE_URL`, `DYNAMO_DELIVERY_TABLE`

**IAM permissions:** `ses:SendEmail`, `ses:SendTemplatedEmail`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `dynamodb:PutItem`

**Pseudocode:**

```
1.  Receive SQS batch (up to 10 email messages)
2.  For each message: { userId, toAddress, templateName, templateData }
3.  Render HTML email using SES template (pre-configured in SES console/CDK)
4.  Call SES SendTemplatedEmail: from=noreply@postopcare.in, to=toAddress, template=templateName, data=templateData
5.  On success: capture MessageId
6.  Write DynamoDB delivery receipt: { pk: notificationId#email, channel: 'email', deliveryStatus: 'sent', sesMessageId }
7.  Delete processed SQS messages in batch
8.  On SES throttle (429): throw → SQS retry with exponential backoff
9.  On permanent SES failure (invalid email, suppression list): write failed status; delete message
10. Batch failure: partial batch response — only delete successful items
```

---

### 4.11 inapp-sender Lambda

**Handler:** `src/handlers/inAppSender.handler`  
**Runtime:** Node.js 22  **Memory:** 128 MB  **Timeout:** 10s  **VPC:** No (API GW WebSocket is public)  
**Trigger:** SQS FIFO `notification-inapp.fifo` (batch size 10)

**Environment variables:** `WEBSOCKET_API_ENDPOINT`, `REDIS_URL`

**IAM permissions:** `execute-api:ManageConnections`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`

**Pseudocode:**

```
1.  Receive SQS batch
2.  For each message: { userId, notificationId, eventType, payload }
3.  Look up Redis key ws:user:{userId} → connectionId
4.  If connectionId found: POST to API Gateway Management API https://{wsEndpoint}/@connections/{connectionId} with JSON payload
5.  On 200: notification delivered; mark in DynamoDB
6.  On 410 GoneException (stale connection): DELETE Redis ws:user:{userId}; mark notification as unread in DB (will be fetched on next poll)
7.  If connectionId not found in Redis: notification already recorded in DB; no push needed
8.  Delete SQS message
9.  On API GW 500: throw → retry via SQS
10. Return batch success
```

---

### 4.12 virus-scan Lambda

**Handler:** `src/handlers/virusScan.handler`  
**Runtime:** Python 3.12  **Memory:** 2048 MB  **Timeout:** 300s  **VPC:** Yes  
**Layer:** ClamAV binaries + latest signatures (rebuilt weekly via CodePipeline)  
**Trigger:** S3 ObjectCreated event on `postopcare-lab-reports` bucket

**Environment variables:** `DB_PROXY_ENDPOINT`, `QUARANTINE_KEY_PREFIX`, `CLAMAV_DB_PATH`

**IAM permissions:** `s3:GetObject`, `s3:PutObjectTagging`, `s3:CopyObject`, `s3:DeleteObject`, `rds-db:connect`

**Pseudocode:**

```
1.  Parse S3 event: extract bucket, objectKey
2.  Download object to /tmp (max 20MB — enforced by presign policy)
3.  Initialize ClamAV engine; load virus definitions from CLAMAV_DB_PATH (Lambda layer)
4.  Scan file: clamscan /tmp/{filename}
5.  If CLEAN: tag S3 object with scan_result=clean; UPDATE attachments SET scan_status='clean' WHERE object_key=:key
6.  If INFECTED: copy object to quarantine prefix (patients/.../quarantine/...); DELETE original; UPDATE attachments SET scan_status='quarantined'; tag copied object scan_result=infected, virus_name={virusName}
7.  If scan ERROR: UPDATE attachments SET scan_status='pending' (will retry); emit CloudWatch metric VirusScanError
8.  Write scan result to CloudWatch structured log: { objectKey, result, virusName, fileSize, durationMs }
9.  If quarantined: publish ATTACHMENT_QUARANTINED event to notification-dispatcher SQS (notify admin)
10. Delete /tmp file; return success
```

---

### 4.13 export Lambda

**Handler:** `src/handlers/export.handler`  
**Runtime:** Node.js 22  **Memory:** 2048 MB  **Timeout:** 120s  **VPC:** Yes  
**Layer:** Chromium/Puppeteer layer (~180MB)

**Environment variables:** `DB_PROXY_ENDPOINT`, `S3_EXPORTS_BUCKET`, `CDN_BASE_URL`, `APP_TEMPLATE_PATH`

**IAM permissions:** `rds-db:connect`, `s3:PutObject`, `s3:GetObject`, `ssm:GetParameter`

**Pseudocode:**

```
1.  Receive event: { exportId, patientId, requestedBy, fromDate, toDate, includeDoseHistory }
2.  Set PG session variables; verify requestedBy has access to patientId
3.  Fetch patient chart: SELECT patient header, all follow_up_rows in date range, dose_changes, doctor_responses, attachments
4.  Fetch assigned doctors list
5.  Render HTML from Handlebars template (mimics paper flowchart layout: landscape table, colour-coded doses)
6.  Launch Puppeteer: const browser = await puppeteer.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] })
7.  Load HTML into page; wait for fonts/tables to settle (networkidle0 + 1s delay)
8.  Generate PDF: page.pdf({ format: 'A3', landscape: true, printBackground: true })
9.  Upload PDF to S3 exports bucket: key = exports/{patientId}/{exportId}.pdf; ContentType = application/pdf
10. Write export record to Redis export:{exportId} → { status: 'ready', s3Key, expiresAt: now+24h } TTL 86400; return downloadUrl (presigned 24h)
```

---

### 4.14 admin Lambda

**Handler:** `src/handlers/admin.handler`  
**Runtime:** Node.js 22  **Memory:** 256 MB  **Timeout:** 15s  **VPC:** Yes

**Environment variables:** `DB_PROXY_ENDPOINT`, `REDIS_URL`, `NOTIFICATION_QUEUE_URL`, `INVITE_TTL_DAYS`

**IAM permissions:** `rds-db:connect`, `sqs:SendMessage`, `ses:SendEmail`

**Pseudocode — POST /admin/patients (onboard new patient):**

```
1.  Validate body with Zod; verify caller role='admin'
2.  Check maxId uniqueness: SELECT id FROM patients WHERE max_id=:maxId
3.  BEGIN transaction
4.  INSERT patient record with all clinical fields
5.  INSERT doctor_patient_assignments for each assignedDoctorId
6.  If protocolId provided: load follow_up_protocols; generate milestones from post_op_checkpoints (date_of_operation + checkpoint.day); INSERT milestones + reminder_schedules for each
7.  Generate first follow-up milestone at date_of_operation + default_follow_up_interval_days
8.  COMMIT transaction
9.  Publish PATIENT_ONBOARDED event to SQS dispatcher (notifies assigned doctors by email/in-app)
10. Return 201 { patientId, milestonesGenerated: count }
```

---

### 4.15 websocket Lambda

**Handler:** `src/handlers/websocket.handler`  
**Runtime:** Node.js 22  **Memory:** 128 MB  **Timeout:** 5s  **VPC:** No (fast cold-start; only touches Redis)

**Environment variables:** `REDIS_URL`, `JWT_SIGNING_KEY`

**IAM permissions:** `secretsmanager:GetSecretValue` (JWT key)

**Pseudocode — $connect:**

```
1.  Extract token from queryStringParameters.token
2.  Verify JWT: check Redis session:{token} exists and not expired
3.  If invalid: return { statusCode: 401 } (rejects WebSocket upgrade)
4.  Extract userId, role from session payload
5.  connectionId = event.requestContext.connectionId
6.  SET Redis ws:conn:{connectionId} → { userId, role } EX 86400
7.  SET Redis ws:user:{userId} → connectionId EX 86400
8.  Log connection event to CloudWatch
9.  Return { statusCode: 200 }
10. (No DB write needed — Redis is source of truth for active connections)
```

**Pseudocode — $disconnect:**

```
1.  connectionId = event.requestContext.connectionId
2.  GET Redis ws:conn:{connectionId} → { userId }
3.  If found: DEL Redis ws:conn:{connectionId}; DEL Redis ws:user:{userId}
4.  Log disconnection event
5.  Return { statusCode: 200 }
6.  (Graceful — no error if connection already expired from Redis)
7-10. (No further action needed)
```


---

## 5. Session & Cache (Redis Key Schema)

All keys use the prefix `postopcare:` in production (configurable via `REDIS_KEY_PREFIX`). ElastiCache Serverless with TLS; no cluster-mode key constraints.

---

### 5.1 Auth & Session Keys

| Key Pattern | TTL | Value Schema | Purpose |
|-------------|-----|--------------|---------|
| `session:{token}` | 2592000s (30d) | `{ "userId": "uuid", "role": "doctor", "patientId": "uuid\|null" }` | Active session validation |
| `oauth_state:{state}` | 300s | `{ "redirectUri": "...", "createdAt": "ISO" }` | CSRF state for OAuth flows |
| `oauth_pkce:{state}` | 300s | `{ "codeChallenge": "...", "method": "S256" }` | PKCE verifier for X OAuth |
| `otp_rate:{phone}` | 3600s | integer counter (INCR) | Rate limiting OTP send (max 3/hr) |
| `otp_verify_rate:{challengeId}` | 300s | integer counter (INCR) | Rate limiting OTP verify (max 5 attempts) |

---

### 5.2 WebSocket Connection Keys

| Key Pattern | TTL | Value Schema | Purpose |
|-------------|-----|--------------|---------|
| `ws:conn:{connectionId}` | 86400s (24h) | `{ "userId": "uuid", "role": "doctor", "connectedAt": "ISO" }` | Reverse lookup by connectionId |
| `ws:user:{userId}` | 86400s (24h) | `"connectionId"` (string) | Forward lookup: userId → active connectionId |

---

### 5.3 Application Cache Keys

| Key Pattern | TTL | Value Schema | Purpose |
|-------------|-----|--------------|---------|
| `patient:{patientId}` | 300s | Serialized patient DTO (JSON) | Patient profile GET cache |
| `milestones:{patientId}:{statusFilter}` | 60s | Serialized milestone list (JSON) | Milestone list cache; short TTL to reflect scheduler updates |
| `export:{exportId}` | 86400s (24h) | `{ "status": "ready\|processing", "s3Key": "...", "expiresAt": "ISO" }` | Export job status |
| `follow_up_draft:{patientId}` | 3600s | `"rowId"` (UUID string) | Soft pointer to in-progress draft row for autosave UX |
| `presign:{objectKey}` | 1800s | `{ "rowId": "uuid", "uploadedBy": "uuid", "mimeType": "..." }` | Pending presigned upload intent; verified at /confirm |
| `rate:api:{userId}` | 60s | integer counter | General API rate limiting per user (e.g., max 120 req/min) |
| `rate:export:{userId}` | 3600s | integer counter | Export rate limiting (max 10 exports/hr per user) |

---

### 5.4 Redis Usage Notes

- **No PHI stored in Redis.** All cached values contain only UUIDs, status strings, and non-clinical metadata.
- Sessions store role and linked patient UUID, not clinical data.
- Cache invalidation: write-through pattern — Lambda functions DEL relevant keys on successful mutations.
- Key expiry is always set explicitly (no persistent keys without TTL).

---

## 6. Notification Pipeline

### 6.1 SQS Queue Topology

| Queue Name | Type | Visibility Timeout | Max Receive Count | DLQ |
|------------|------|--------------------|-------------------|-----|
| `notification-events` | Standard | 30s | 3 | `notification-events-dlq` |
| `notification-inapp.fifo` | FIFO | 10s | 3 | `notification-inapp-dlq.fifo` |
| `notification-email.fifo` | FIFO | 60s | 3 | `notification-email-dlq.fifo` |
| `notification-sms.fifo` | FIFO | 60s | 3 | `notification-sms-dlq.fifo` |
| `notification-whatsapp.fifo` | FIFO | 60s | 3 | `notification-whatsapp-dlq.fifo` |

FIFO deduplication window: 5 minutes. `MessageDeduplicationId` = `{reminderId}#{channel}` for milestone reminders; `{notificationId}#{channel}` for event-driven notifications.

---

### 6.2 SQS Message Schemas

**notification-events (Standard queue — internal fan-out input):**

```json
{
  "eventId": "uuid",
  "eventType": "FOLLOWUP_SUBMITTED | DOCTOR_RESPONDED | MILESTONE_OVERDUE | ATTACHMENT_QUARANTINED",
  "patientId": "uuid",
  "actorId": "uuid",
  "timestamp": "2026-08-16T10:42:00Z",
  "payload": {
    "rowId": "uuid",
    "ppDate": "2026-08-16",
    "doctorName": "Dr. Rajesh Dey"
  }
}
```

**notification-sms.fifo:**

```json
{
  "messageId": "uuid",
  "reminderId": "uuid | null",
  "notificationId": "uuid | null",
  "recipientPhone": "+919876543210",
  "messageTemplate": "advance_reminder | due_day_reminder | overdue_reminder | doctor_responded",
  "templateParams": {
    "dueDate": "20 Aug 2026",
    "deepLink": "https://app.postopcare.in/patient/followup/new",
    "appName": "PostOp Care"
  },
  "dltTemplateId": "1007XXXXXXXXXX",
  "patientId": "uuid",
  "enqueuedAt": "2026-08-18T02:30:00Z"
}
```

**notification-whatsapp.fifo:**

```json
{
  "messageId": "uuid",
  "reminderId": "uuid | null",
  "notificationId": "uuid | null",
  "recipientPhone": "+919876543210",
  "templateName": "postopcare_advance_reminder",
  "templateLanguage": "en",
  "templateComponents": [
    { "type": "body", "parameters": [
        { "type": "text", "text": "20 Aug 2026" },
        { "type": "text", "text": "https://app.postopcare.in/..." }
    ]}
  ],
  "patientId": "uuid",
  "enqueuedAt": "2026-08-18T02:30:00Z"
}
```

**notification-email.fifo:**

```json
{
  "messageId": "uuid",
  "notificationId": "uuid",
  "toAddress": "doctor@hospital.com",
  "templateName": "ses_followup_submitted | ses_doctor_responded",
  "templateData": {
    "doctorName": "Dr. Rajesh Dey",
    "patientName": "Raghavendra S.",
    "ppDate": "16 Aug 2026",
    "chartLink": "https://app.postopcare.in/doctor/patients/uuid/review/rowId"
  },
  "enqueuedAt": "2026-08-16T10:42:00Z"
}
```

**notification-inapp.fifo:**

```json
{
  "messageId": "uuid",
  "notificationId": "uuid",
  "userId": "uuid",
  "eventType": "DOCTOR_RESPONDED",
  "pushPayload": {
    "title": "Doctor responded",
    "body": "Dr. Rajesh Dey reviewed your 16 Aug submission.",
    "rowId": "uuid"
  },
  "enqueuedAt": "2026-08-17T09:15:00Z"
}
```

---

### 6.3 Retry Strategy

| Stage | Behavior |
|-------|----------|
| SQS → Lambda (transient failure) | SQS retries up to `maxReceiveCount` (3) with visibility timeout backoff |
| Permanent provider failure (4xx) | Lambda deletes message immediately; writes `failed` status to DynamoDB |
| Transient provider failure (5xx, timeout) | Lambda throws; SQS redelivers after visibility timeout |
| DLQ arrival | CloudWatch alarm fires; on-call alert via SNS; ops team reviews and replays or discards |

---

### 6.4 DLQ Handling

Each channel queue has a paired DLQ. A CloudWatch Alarm monitors `ApproximateNumberOfMessagesVisible > 0` on each DLQ and notifies via SNS → email/PagerDuty.

Ops runbook:
1. Inspect DLQ messages in SQS console.
2. Fix root cause (e.g., invalid phone, expired API key).
3. Use SQS "Start DLQ Redrive" to replay messages back to source queue.
4. Monitor CloudWatch for successful delivery.

---

### 6.5 Delivery Receipt DynamoDB Schema

**Table:** `reminder_delivery`  
**Partition key:** `pk` = `{reminderId}#{channel}` (String)  
**Sort key:** none  
**TTL attribute:** `ttl` (Unix epoch) — 7 years

```json
{
  "pk": "uuid-reminderId#sms",
  "reminderId": "uuid",
  "notificationId": "uuid | null",
  "channel": "sms | whatsapp | email | inapp",
  "patientId": "uuid",
  "recipientAddress": "+919876543210",
  "deliveryStatus": "queued | sent | delivered | failed | read",
  "providerMessageId": "MSG91-XXXXXXX",
  "failureReason": null,
  "sentAt": "2026-08-18T02:30:05Z",
  "deliveredAt": "2026-08-18T02:30:08Z",
  "ttl": 1976659200
}
```

Provider webhooks (MSG91, Meta) call a lightweight webhook Lambda that does `UpdateItem` on `deliveryStatus` and `deliveredAt`.

---

## 7. Milestone Scheduler

### 7.1 SQL Queries Used by MilestoneEvaluator

**Query 1 — Fetch due reminder schedules within window:**

```sql
SELECT
    rs.id              AS reminder_schedule_id,
    rs.milestone_id,
    rs.reminder_type,
    rs.scheduled_at,
    m.patient_id,
    m.title            AS milestone_title,
    m.due_date,
    m.type             AS milestone_type,
    p.phone_number,
    p.whatsapp_number,
    p.reminder_preferences,
    p.reminder_opt_out
FROM  reminder_schedules rs
JOIN  milestones m  ON m.id = rs.milestone_id
JOIN  patients   p  ON p.id = m.patient_id
WHERE rs.status            = 'pending'
  AND rs.scheduled_at      <= :window_end        -- NOW() + 2h for hourly, +48h for daily
  AND rs.scheduled_at      >= NOW() - INTERVAL '10 minutes'  -- avoid reprocessing old rows
  AND m.status             = 'scheduled'
  AND p.reminder_opt_out   = FALSE
FOR UPDATE OF rs SKIP LOCKED;                    -- prevents double-dispatch on concurrent runs
```

**Query 2 — Detect overdue milestones:**

```sql
SELECT
    m.id,
    m.patient_id,
    m.title,
    m.due_date,
    m.type
FROM  milestones m
WHERE m.status   = 'scheduled'
  AND m.due_date < CURRENT_DATE
  AND NOT EXISTS (
      SELECT 1 FROM reminder_schedules rs
      WHERE  rs.milestone_id = m.id
        AND  rs.reminder_type IN ('overdue', 'final_overdue')
        AND  rs.status        = 'sent'
  );
```

**Query 3 — Mark overdue:**

```sql
UPDATE milestones
SET    status = 'overdue'
WHERE  status   = 'scheduled'
  AND  due_date < CURRENT_DATE;
```

**Query 4 — Cancel reminders on patient submission:**

```sql
UPDATE reminder_schedules
SET    status = 'cancelled'
WHERE  milestone_id = :milestone_id
  AND  status       = 'pending';
```

**Query 5 — Generate milestone reminders for new milestone:**

```sql
INSERT INTO reminder_schedules (id, milestone_id, reminder_type, offset_days, scheduled_at, status)
VALUES
    (uuid_generate_v4(), :milestone_id, 'advance',       -2, :due_date_at_08_ist + INTERVAL '-2 days', 'pending'),
    (uuid_generate_v4(), :milestone_id, 'due_day',        0, :due_date_at_08_ist,                       'pending'),
    (uuid_generate_v4(), :milestone_id, 'overdue',        1, :due_date_at_08_ist + INTERVAL '1 day',    'pending'),
    (uuid_generate_v4(), :milestone_id, 'final_overdue',  3, :due_date_at_08_ist + INTERVAL '3 days',   'pending')
ON CONFLICT (milestone_id, reminder_type) DO NOTHING;
-- :due_date_at_08_ist = (due_date || ' 08:00:00')::TIMESTAMPTZ AT TIME ZONE 'Asia/Kolkata'
```

---

### 7.2 Decision Tree

```
EventBridge fires MilestoneEvaluator
│
├─ Compute window_end (hourly: +2h │ daily: +48h)
│
├─ Query 1: fetch due reminder_schedules (SKIP LOCKED)
│   │
│   └─ For each reminder_schedule:
│       ├─ patient.reminder_opt_out = TRUE  →  SKIP
│       ├─ reminder_preferences.sms_enabled AND phone_number exists
│       │       →  Enqueue to notification-sms.fifo
│       └─ reminder_preferences.whatsapp_enabled AND whatsapp_number exists
│               →  Enqueue to notification-whatsapp.fifo
│       └─ UPDATE reminder_schedule.status = 'sent', sent_at = NOW()
│
├─ Query 2 + 3: detect and mark overdue milestones
│   └─ For each newly overdue milestone:
│       ├─ Insert overdue reminder_schedule if not yet exists
│       └─ [Phase 2] Enqueue doctor alert via notification-dispatcher
│
└─ Log summary metrics to CloudWatch
```

---

### 7.3 Timezone Handling (Asia/Kolkata)

All `scheduled_at` values in `reminder_schedules` are stored as `TIMESTAMPTZ` (UTC internally). Computation:

```sql
-- When inserting reminder_schedules, convert "08:00 IST on due_date" to UTC:
SELECT (due_date::TEXT || ' 08:00:00 Asia/Kolkata')::TIMESTAMPTZ
-- Result stored as UTC (02:30:00+00 = 08:00:00+05:30)
```

The Lambda evaluator compares `rs.scheduled_at <= NOW()` entirely in UTC — no runtime timezone conversion needed. The patient-visible display layer (frontend) formats timestamps in IST using `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`.

For patients with a non-IST timezone (future feature), `reminder_preferences.timezone` would replace `'Asia/Kolkata'` in the SQL computation at milestone creation time.

---

### 7.4 Cancellation When Patient Submits

```
Patient calls PUT /followup/rows/:id/submit
→ followup Lambda:
    1. UPDATE follow_up_rows SET status='pending', submitted_at=NOW()
    2. SELECT id FROM milestones
         WHERE patient_id = :patientId
           AND type IN ('follow_up', 'drug_level')
           AND status = 'scheduled'
           AND due_date >= CURRENT_DATE - INTERVAL '3 days'  -- recent window
         ORDER BY due_date ASC
         LIMIT 1
    3. If milestone found:
         a. UPDATE milestones SET linked_follow_up_row_id = :rowId  (link submission)
         b. UPDATE reminder_schedules SET status = 'cancelled'
              WHERE milestone_id = :milestoneId AND status = 'pending'
         c. (Do NOT mark milestone 'completed' yet — completion happens when doctor reviews)
    4. COMMIT
```

---

## 8. File Upload Flow

```
Patient (Browser/App)              API Gateway          followup Lambda       S3 (lab-reports)       virus-scan Lambda       DB (Aurora)
        │                               │                      │                     │                        │                   │
        │ POST /followup/rows/:id/      │                      │                     │                        │                   │
        │   attachments/presign         │                      │                     │                        │                   │
        │ { filename, mimeType, size }  │                      │                     │                        │                   │
        │──────────────────────────────►│                      │                     │                        │                   │
        │                               │ JWT validated        │                     │                        │                   │
        │                               │─────────────────────►│                     │                        │                   │
        │                               │                      │ Validate MIME/size  │                        │                   │
        │                               │                      │ Generate objectKey  │                        │                   │
        │                               │                      │ S3 presignedPutUrl  │                        │                   │
        │                               │                      │────────────────────►│ (presign only, no PUT) │                   │
        │                               │                      │◄────────────────────│ returns presigned URL  │                   │
        │                               │                      │ Store intent        │                        │                   │
        │                               │                      │   in Redis          │                        │                   │
        │                               │◄─────────────────────│                     │                        │                   │
        │ 201 { uploadUrl, objectKey }  │                      │                     │                        │                   │
        │◄──────────────────────────────│                      │                     │                        │                   │
        │                               │                      │                     │                        │                   │
        │ PUT {uploadUrl}               │                      │                     │                        │                   │
        │   (direct to S3, no proxy)    │                      │                     │                        │                   │
        │──────────────────────────────────────────────────────────────────────────►│                        │                   │
        │                               │                      │                     │ Object stored          │                   │
        │◄──────────────────────────────────────────────────────────────────────────│ S3 200 OK              │                   │
        │                               │                      │                     │                        │                   │
        │ POST /followup/rows/:id/      │                      │                     │                        │                   │
        │   attachments/confirm         │                      │                     │                        │                   │
        │ { objectKey }                 │                      │                     │                        │                   │
        │──────────────────────────────►│─────────────────────►│                     │                        │                   │
        │                               │                      │ HeadObject check ──►│                        │                   │
        │                               │                      │◄────────────────────│ 200 (object exists)    │                   │
        │                               │                      │                     │                        │                   │
        │                               │                      │ INSERT attachments  │                        │                   │
        │                               │                      │   scan_status=      │                        │──────────────────►│
        │                               │                      │   'pending'         │                        │                   │
        │                               │◄─────────────────────│                     │                        │                   │
        │ 201 { attachmentId,           │                      │                     │                        │                   │
        │       scanStatus: 'pending' } │                      │                     │                        │                   │
        │◄──────────────────────────────│                      │                     │                        │                   │
        │                               │                      │                     │                        │                   │
        │                               │                      │             S3 ObjectCreated event           │                   │
        │                               │                      │             ────────────────────────────────►│                   │
        │                               │                      │                     │                        │ Download to /tmp  │
        │                               │                      │                     │                        │ ClamAV scan       │
        │                               │                      │                     │                        │                   │
        │                               │                      │                     │   ┌── CLEAN ───────────►│ UPDATE scan_status│
        │                               │                      │                     │   │                    │   = 'clean'  ────►│
        │                               │                      │                     │   │                    │                   │
        │                               │                      │                     │   └── INFECTED ────────►│ Copy to          │
        │                               │                      │                     │                        │ quarantine prefix │
        │                               │                      │                     │                        │ Delete original   │
        │                               │                      │                     │                        │ UPDATE scan_status│
        │                               │                      │                     │                        │   = 'quarantined'►│
        │                               │                      │                     │                        │                   │
```

**State machine summary:**

```
attachment.scan_status transitions:
  pending  ──(ClamAV clean)──►  clean
  pending  ──(ClamAV infected)──►  quarantined
  pending  ──(scan error, retry)──►  pending  (CloudWatch alarm after 3 failures)
```

Attachments with `scan_status = 'pending'` or `'quarantined'` are not served to clients (presigned download URL generation checks `scan_status = 'clean'`).

---

## 9. Error Handling Standard

### 9.1 Error Response Envelope

All API errors return the standard envelope with an appropriate HTTP status code:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "pp_date is required",
    "details": {
      "field": "ppDate",
      "constraint": "required"
    },
    "requestId": "api-gw-request-id-xyz",
    "timestamp": "2026-08-16T10:42:00Z"
  }
}
```

---

### 9.2 Application Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body or query params failed schema validation |
| `INVALID_OTP` | 401 | OTP code is incorrect |
| `OTP_EXPIRED` | 400 | OTP challenge has expired |
| `OTP_MAX_ATTEMPTS` | 429 | Too many OTP verify attempts; challenge invalidated |
| `UNAUTHENTICATED` | 401 | No session / expired session / revoked session |
| `FORBIDDEN` | 403 | Authenticated but not authorized (role or assignment check failed) |
| `NOT_FOUND` | 404 | Requested resource does not exist |
| `CONFLICT` | 409 | Resource already exists (duplicate maxId, duplicate pp_date, duplicate doctor_response) |
| `GONE` | 410 | Export expired or previously deleted |
| `PAYLOAD_TOO_LARGE` | 413 | File upload exceeds 20MB limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | MIME type not in allowlist |
| `RATE_LIMITED` | 429 | API rate limit exceeded |
| `INVALID_STATUS_TRANSITION` | 422 | Attempted status change not allowed (e.g., draft→reviewed without submit) |
| `ATTACHMENT_NOT_CLEAN` | 422 | Attempted to use attachment that is pending scan or quarantined |
| `DOCTOR_NOT_ASSIGNED` | 403 | Doctor attempting to access unassigned patient |
| `INTERNAL_ERROR` | 500 | Unhandled server error; requestId included for log correlation |
| `SERVICE_UNAVAILABLE` | 503 | Upstream dependency (RDS, Redis, SMS gateway) unavailable |

---

### 9.3 Lambda Error Handling Pattern

Every Lambda handler wraps execution in a try/catch block:

```javascript
export const handler = async (event, context) => {
  const requestId = event.requestContext?.requestId ?? context.awsRequestId;
  try {
    // Set PG session variables
    await db.query(`SET app.current_user_id = '${userId}'`);
    await db.query(`SET app.current_role = '${role}'`);

    const result = await executeBusinessLogic(event);
    return successResponse(result);

  } catch (err) {
    if (err instanceof AppError) {
      // Known application error — do not retry
      logger.warn({ requestId, code: err.code, message: err.message });
      return errorResponse(err.statusCode, err.code, err.message, requestId);
    }
    // Unknown error — log and let Lambda retry if idempotent
    logger.error({ requestId, error: err.message, stack: err.stack });
    throw err;  // Lambda retries (async invocations) or SQS redelivers
  }
};
```

---

### 9.4 Lambda Retry and DLQ Policies

| Lambda trigger | Retry behavior | DLQ / failure destination |
|----------------|----------------|---------------------------|
| API Gateway (synchronous) | No retry — error returned to caller immediately | N/A |
| SQS (notification queues) | SQS redelivers up to `maxReceiveCount=3` (visibility timeout backoff: 30s → 60s → 120s) | Per-queue DLQ; CloudWatch alarm on DLQ depth > 0 |
| EventBridge (MilestoneEvaluator) | EventBridge retries up to 2 times with exponential backoff | Lambda failure destination → SNS alert |
| S3 event (virus-scan) | S3 notification retries if Lambda returns error | Lambda async failure destination → SQS DLQ → alarm |

---

### 9.5 Structured Logging Standard

All Lambdas emit JSON-structured logs to CloudWatch:

```json
{
  "level": "INFO | WARN | ERROR",
  "requestId": "api-gw-request-id",
  "lambdaRequestId": "aws-request-id",
  "userId": "uuid",
  "role": "doctor",
  "patientId": "uuid | null",
  "action": "FOLLOWUP_SUBMIT",
  "durationMs": 145,
  "message": "Follow-up row submitted successfully",
  "timestamp": "2026-08-16T10:42:00.123Z"
}
```

PHI must never appear in log messages (no lab values, dose amounts, diagnoses). UUIDs are acceptable as they are not directly identifying without database access.

---

*End of LLD — PostOp Care Platform v1.0*
