-- =============================================================================
-- V10 — Milestones & reminder schedules (WP 4.2 — spec §7.6, LLD §4.5/§4.6)
-- Source of truth: LLD §1.9 (enums), §1.10 (milestones), §1.11
-- (reminder_schedules), §2.6 (milestones RLS), §2.7 (reminder_schedules RLS).
-- Target engine: PostgreSQL 16 (Aurora Serverless v2), region ap-south-1.
--
-- Scope (WP 4.2): the scheduling backbone — milestones (follow-up due dates,
-- doctor-ordered tests, overdue markers) and the per-milestone reminder
-- schedule rows the milestone-evaluator fires. A follow-up submission cancels
-- the pending reminders for the patient's scheduled follow_up milestone.
--
-- Reminder cadence (LLD §4.6): per milestone, four reminders relative to
-- due_date at 08:00 IST — advance (-2d), due_day (0), overdue (+1d),
-- final_overdue (+3d). The uq_reminder_milestone_type constraint guarantees no
-- duplicate reminder of a given type per milestone (satisfies M-09).
-- =============================================================================

-- ── 1.9 Milestone / reminder enums ───────────────────────────────────────────
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

-- ── 1.10 Table: milestones ────────────────────────────────────────────────────
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
    linked_follow_up_row_id UUID,               -- set when the patient submits
    doctor_response_id      UUID,               -- set for doctor_ordered milestones
    created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);

CREATE INDEX idx_milestones_patient_id     ON milestones (patient_id);
CREATE INDEX idx_milestones_due_date       ON milestones (due_date);
CREATE INDEX idx_milestones_status         ON milestones (status);
CREATE INDEX idx_milestones_patient_status ON milestones (patient_id, status);
CREATE INDEX idx_milestones_due_scheduled  ON milestones (due_date, status)
    WHERE status = 'scheduled';

-- ── 1.11 Table: reminder_schedules ───────────────────────────────────────────
CREATE TABLE reminder_schedules (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    milestone_id    UUID                NOT NULL
                        REFERENCES milestones (id) ON DELETE CASCADE,
    reminder_type   reminder_type_enum  NOT NULL,
    offset_days     INT                 NOT NULL,   -- negative=before, 0=due day, positive=after
    scheduled_at    TIMESTAMPTZ         NOT NULL,   -- due_date + offset_days at 08:00 IST
    status          reminder_status     NOT NULL DEFAULT 'pending',
    sent_at         TIMESTAMPTZ,

    CONSTRAINT uq_reminder_milestone_type
        UNIQUE (milestone_id, reminder_type)        -- M-09: no duplicate reminders
);

CREATE INDEX idx_reminder_schedules_milestone_id ON reminder_schedules (milestone_id);
CREATE INDEX idx_reminder_schedules_status       ON reminder_schedules (status);
CREATE INDEX idx_reminder_schedules_scheduled_at ON reminder_schedules (scheduled_at)
    WHERE status = 'pending';

-- =============================================================================
-- 2.6 RLS — milestones
-- patient/caregiver read own; assigned doctor read/insert/update; admin all.
-- =============================================================================
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON milestones TO ${app_db_role};

CREATE POLICY ms_patient_select ON milestones
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND patient_id = app_current_patient_id()
    );

CREATE POLICY ms_doctor_select ON milestones
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    );

CREATE POLICY ms_doctor_insert ON milestones
    FOR INSERT TO ${app_db_role}
    WITH CHECK (
        app_current_role() = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    );

CREATE POLICY ms_doctor_update ON milestones
    FOR UPDATE TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND patient_id IN (
            SELECT patient_id FROM doctor_patient_assignments
            WHERE  doctor_id = app_current_user_id()
        )
    );

CREATE POLICY ms_admin_all ON milestones
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');

-- =============================================================================
-- 2.7 RLS — reminder_schedules
-- patient/caregiver read (via their milestones); assigned doctor + admin manage.
-- The milestone-evaluator runs under a scoped service path (admin context) when
-- it flips pending->sent and inserts overdue reminders.
-- =============================================================================
ALTER TABLE reminder_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_schedules FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_schedules TO ${app_db_role};

CREATE POLICY rs_patient_select ON reminder_schedules
    FOR SELECT TO ${app_db_role}
    USING (
        app_current_role() IN ('patient', 'caregiver')
        AND milestone_id IN (
            SELECT id FROM milestones
            WHERE  patient_id = app_current_patient_id()
        )
    );

CREATE POLICY rs_doctor_all ON reminder_schedules
    FOR ALL TO ${app_db_role}
    USING (
        app_current_role() = 'doctor'
        AND milestone_id IN (
            SELECT m.id FROM milestones m
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = m.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    )
    WITH CHECK (
        app_current_role() = 'doctor'
        AND milestone_id IN (
            SELECT m.id FROM milestones m
            JOIN   doctor_patient_assignments dpa ON dpa.patient_id = m.patient_id
            WHERE  dpa.doctor_id = app_current_user_id()
        )
    );

CREATE POLICY rs_admin_all ON reminder_schedules
    FOR ALL TO ${app_db_role}
    USING (app_current_role() = 'admin')
    WITH CHECK (app_current_role() = 'admin');
