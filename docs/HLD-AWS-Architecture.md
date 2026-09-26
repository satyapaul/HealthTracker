# High-Level Design (HLD)

# Post-Operative Investigation Follow-Up Platform

| Field             | Value                                       |
| ----------------- | ------------------------------------------- |
| **Document type** | High-Level Design & AWS Technology Topology |
| **Version**       | 2.0                                         |
| **Date**          | August 29, 2026                             |
| **Based on**      | Application Specification v1.7              |
| **Supersedes**    | HLD v1.0 (based on App Spec v1.3)           |

> **What changed from HLD v1.0 → v2.0**
> HLD v1.0 was based on Application Spec v1.3. The spec has since advanced to **v1.7**, adding three major feature areas that materially affect the architecture:
>
> 1. **Conversational Chat** (spec §7.8) — real-time patient↔care-team messaging with text, voice notes, image/PDF attachments, system event cards, and an immutable transcript.
> 2. **Multi-Doctor Collaboration & Case Transfer** (spec §7.9) — care-team authorization (primary / co-managing / consulting / transferred roles) and formal primary-ownership handoff with an audit trail.
> 3. **Hospital Registry & engagement-level hospital association** (spec §7.0, v1.7) — an admin-managed hospital directory, doctor–hospital affiliations, a system-seeded Virtual Hospital record, and a required `engagement_hospital_id` on every follow-up row.
>
> This revision integrates those features into the topology, data layer, real-time layer, RBAC model, MVP scope, and ADRs. Sections carrying new/changed content are marked with 🆕 (new area) or ✳️ (modified from v1.0).

---

## 1. Design Principles

1. **PHI containment** — All protected health information stays within AWS region ap-south-1 (Mumbai) to satisfy Indian healthcare data residency norms.
2. **Serverless-first** — Prefer managed services over self-managed compute to reduce operational overhead for a small clinic-scale system.
3. **Multi-channel notifications as first-class citizen** — SMS and WhatsApp reminder delivery is in MVP scope; the architecture treats the notification pipeline with the same reliability bar as the core write path.
4. **Auditability by design** — Every mutation to PHI, every dose change, every chat message, every authorization grant, and every case transfer must be immutably logged; the audit trail is not an afterthought.
5. **Least-privilege, role-based access** — Patient sees only their chart; doctors see only patients where they hold an active care-team role (primary, co-managing, or consulting). Enforced at both the API layer and the data layer.
6. **Cost-aware scaling** — The initial user base is small (tens of patients). Services are sized for low cost and scaled reactively.
7. **✳️ Real-time collaboration** — Chat and in-app notifications share a single managed WebSocket layer with sub-second delivery; message state (delivered/read) is first-class.
8. **🆕 Facility-scoped records** — Every clinical engagement is bound to a hospital or the Virtual Hospital, so records can be filtered, reported, and governed per facility without cross-tenant leakage.

---

## 2. System Context

```
                   ┌──────────────────────────────────────┐
                   │           External Actors            │
                   │                                      │
                   │  Patient / Caregiver (mobile/web)    │
                   │  Doctor / Care team (desktop/web)    │
                   │  Admin (desktop)                     │
                   └──────────────┬───────────────────────┘
                                  │ HTTPS
                   ┌──────────────▼───────────────────────┐
                   │           AWS Cloud (ap-south-1)     │
                   │                                      │
                   │   ┌──────────────────────────────┐   │
                   │   │   PostOp Care Platform        │   │
                   │   │   (described in this HLD)     │   │
                   │   └──────────────────────────────┘   │
                   └──────────────┬───────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
    ┌────▼─────┐            ┌─────▼────┐             ┌────▼─────┐
    │  Google  │            │WhatsApp  │             │  SMS     │
    │  / X     │            │Business  │             │ Gateway  │
    │  OAuth   │            │  API     │             │ (MSG91 / │
    └──────────┘            └──────────┘             │  Twilio) │
                                                     └──────────┘
```

---

## 3. Logical Architecture — Three-Layer Model

The platform is organized into three logical layers. Each layer maps to specific AWS services described in §4.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: PRESENTATION                                              │
│                                                                     │
│  React SPA (Patient Portal + Doctor Portal + Admin Portal)          │
│  Hosted on S3 + CloudFront (CDN, HTTPS termination, WAF)            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST / WebSocket (API Gateway)
┌──────────────────────────────▼──────────────────────────────────────┐
│  Layer 2: APPLICATION                                               │
│                                                                     │
│  ┌─────────────────┐  ┌────────────────┐  ┌────────────────────┐   │
│  │  Auth Service   │  │  Core API      │  │  Notification      │   │
│  │  (Lambda)       │  │  (Lambda /     │  │  Service           │   │
│  │  Google OAuth   │  │  ECS Fargate)  │  │  (Lambda + SQS)    │   │
│  │  X OAuth        │  │                │  │  SMS / WhatsApp    │   │
│  │  SMS OTP        │  │                │  │  / Email / Push    │   │
│  └─────────────────┘  └────────────────┘  └────────────────────┘   │
│                                                                     │
│  ┌─────────────────┐  ┌────────────────┐  ┌────────────────────┐   │
│  │ 🆕 Chat Engine  │  │ 🆕 Care Team & │  │ 🆕 Hospital        │   │
│  │ (WebSocket API  │  │ Transfer Svc   │  │ Registry Svc       │   │
│  │  + Lambda)      │  │ (Lambda)       │  │ (Lambda)           │   │
│  │ text/voice/att, │  │ authz grants,  │  │ hospital CRUD,     │   │
│  │ read receipts,  │  │ case transfer, │  │ doctor affiliation,│   │
│  │ system cards    │  │ audit trail    │  │ Virtual Hospital   │   │
│  └─────────────────┘  └────────────────┘  └────────────────────┘   │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Milestone Scheduler (EventBridge Scheduler + Lambda)      │     │
│  │  Daily cron + hourly cron; evaluates due reminders         │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  File Processing Service (S3 event trigger → Lambda)       │     │
│  │  Virus scan (ClamAV on Lambda) + thumbnail generation      │     │
│  │  ✳️ Also scans chat attachments & voice notes              │     │
│  └────────────────────────────────────────────────────────────┘     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  Layer 3: DATA                                                      │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  PostgreSQL  │  │  S3 Buckets  │  │  ElastiCache │              │
│  │  (RDS Aurora │  │  (Lab reports│  │  (Redis)     │              │
│  │  Serverless  │  │   + exports  │  │  Sessions,   │              │
│  │  v2)         │  │   ✳️+ chat   │  │  OTP cache,  │              │
│  │  ✳️ chat,    │  │   media/voice│  │  rate limits,│              │
│  │  hospitals,  │  │   ✳️+ logos) │  │  ✳️ WS conns,│              │
│  │  authz,xfer  │  │              │  │  hosp cache) │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐                                 │
│  │  DynamoDB    │  │  CloudWatch  │                                 │
│  │  (Audit log, │  │  Logs        │                                 │
│  │  Reminder    │  │  (immutable  │                                 │
│  │  delivery    │  │  audit trail)│                                 │
│  │  receipts,   │  │              │                                 │
│  │  ✳️ chat WS  │  │              │                                 │
│  │  connections)│  │              │                                 │
│  └──────────────┘  └──────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. AWS Technology Topology — Service-by-Service

### 4.1 Networking & Edge

| Component               | AWS Service              | Rationale                                                                                     |
| ----------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| DNS                     | Route 53                 | Managed DNS with health checks; alias records to CloudFront and ALB                           |
| CDN + HTTPS termination | CloudFront               | Edge caching of SPA assets; TLS offload; Origin Access Control to S3                          |
| DDoS & WAF              | AWS WAF on CloudFront    | Block OWASP top-10 exploits, rate-limit auth endpoints, geo-restrict if needed                |
| API edge                | API Gateway (HTTP API)   | Low-latency JWT authorizer; routes to Lambda functions; WebSocket for real-time notifications |
| VPC                     | Single VPC in ap-south-1 | Two private subnets (AZ-a, AZ-b) for RDS and Redis; no public subnets for compute             |
| NAT                     | NAT Gateway (one per AZ) | Lambda and Fargate in private subnets reach internet (OAuth, SMS, WhatsApp APIs)              |

### 4.2 Frontend Hosting

| Component             | AWS Service              | Notes                                                                                                     |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| SPA bundle storage    | S3 (versioned bucket)    | Patient portal, doctor portal, admin portal served as a single React app with route-based role separation |
| Static asset delivery | CloudFront distribution  | `app.postopcare.in` → CloudFront → S3 origin                                                              |
| CI/CD deployment      | CodePipeline + CodeBuild | On merge to main: build, test, upload to S3, CloudFront cache invalidation                                |

### 4.3 Authentication Service

OAuth and OTP are security-sensitive; isolated as a dedicated Lambda-backed microservice behind its own API Gateway routes (`/auth/*`).

```
                ┌─────────────────────────────────────────────────┐
                │  Auth Lambda (Node.js / Python)                  │
                │                                                  │
                │  POST /auth/google/callback   ─► Google tokeninfo│
                │  POST /auth/x/callback        ─► X user-info API │
                │  POST /auth/otp/send          ─► SMS Gateway      │
                │  POST /auth/otp/verify        ─► verify hash      │
                │  POST /auth/session/revoke                        │
                │                                                  │
                │  AuthIdentity, User, OtpChallenge  ─► RDS Aurora │
                │  Session tokens (JWT, 30d TTL)      ─► Redis      │
                │  OTP hash (bcrypt)                  ─► Redis TTL  │
                │  Rate limit counters                ─► Redis      │
                │  Audit events                       ─► DynamoDB   │
                └─────────────────────────────────────────────────┘
```

| AWS Service                        | Usage                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Lambda (auth)                      | Stateless function; cold-start acceptable for auth path                             |
| Secrets Manager                    | Store Google client secret, X client secret, JWT signing key; rotated automatically |
| ElastiCache for Redis (Serverless) | OTP hashes (5-min TTL), session tokens, rate-limit counters                         |
| Systems Manager Parameter Store    | Non-secret config (OAuth redirect URIs, OTP length, rate-limit thresholds)          |

### 4.4 Core Application API

The Core API handles all clinical data: patient charts, follow-up rows, doctor responses, file metadata, milestones.

**Compute choice:** Start with Lambda (per-function routing). Migrate to ECS Fargate if cold-start latency becomes unacceptable under sustained doctor traffic.

```
API Gateway (HTTP API)
    │
    ├── /patients/*         → Lambda: PatientService
    ├── /followup/*         → Lambda: FollowUpService  (✳️ now carries engagement_hospital_id)
    ├── /doses/*            → Lambda: DoseService  (dose change, audit)
    ├── /milestones/*       → Lambda: MilestoneService
    ├── /notifications/*    → Lambda: NotificationService
    ├── 🆕 /chat/*          → Lambda: ChatService  (threads, messages, attachments, receipts)
    ├── 🆕 /care-team/*     → Lambda: CareTeamService  (authorization grants, revoke)
    ├── 🆕 /transfers/*     → Lambda: CaseTransferService  (initiate/accept/decline/force)
    ├── 🆕 /hospitals/*     → Lambda: HospitalService  (list affiliated, picker lookup)
    └── /admin/*            → Lambda: AdminService  (✳️ + hospital & affiliation CRUD)
```

**🆕 WebSocket API (separate API Gateway):** `wss://ws.postopcare.in` backs both real-time chat (spec §7.8) and in-app notifications (§4.8, §4.14). Routes: `$connect`, `$disconnect`, `sendMessage`, `markRead`, `typing`.

All Lambdas share a VPC-attached RDS Proxy → Aurora PostgreSQL Serverless v2.

**JWT Authorizer on API Gateway:**

- Validates token from Redis on every request.
- Injects `{ userId, role, patientId? }` into Lambda context.
- Rejects expired or revoked sessions before Lambdas execute.

### 4.5 Database — Aurora PostgreSQL Serverless v2

Primary relational store for all entities from the data model (§9 of spec).

| Characteristic    | Choice                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| Engine            | Aurora PostgreSQL 16 compatible                                                 |
| Mode              | Serverless v2 — scales ACUs 0.5 → 16 (cost-optimal for clinic-scale load)       |
| Multi-AZ          | Writer + one reader in different AZs (failover < 30s, satisfies 99.5% SLO)      |
| Encryption        | AWS-managed KMS key (PHI at rest)                                               |
| Backup            | Automated daily snapshots, 35-day retention; point-in-time recovery ≤ 5-min RPO |
| Proxy             | RDS Proxy (Lambda connection pooling; prevents exhaustion during burst)         |
| Schema migrations | Flyway (run in CodeBuild pipeline step, pre-deployment)                         |

Key tables (from spec data model):
`users`, `auth_identities`, `auth_sessions`, `otp_challenges`, `patients`, `follow_up_protocols`, `milestones`, `reminder_schedules`, `follow_up_rows`, `dose_changes`, `doctor_responses`, `notifications`

**✳️ New tables introduced by spec v1.4–v1.7:**

- `chat_threads` — per-patient threads; `thread_type ∈ {patient_care_team, doctor_internal_consult}`.
- `chat_messages` — text/voice/attachment/system-card messages; `sender_role`, `urgency_flag`, `linked_follow_up_row_id`, `read_by_user_ids`.
- `chat_attachments` — file metadata (image/pdf/audio) → S3 object keys.
- `doctor_authorizations` — care-team grants; `access_level ∈ {co_managing, consult_view}`, `status`, `expires_at`.
- `case_transfer_log` — primary-ownership handoffs; `status ∈ {pending, accepted, declined, admin_forced}`, `handoff_note`.
- 🆕 `hospitals` — registry; `hospital_code` (unique, `VIRTUAL` reserved), `hospital_type`, address, `logo_url`, `status`.
- 🆕 `hospital_doctor_affiliations` — doctor↔hospital join; `role_at_hospital`, `is_primary`, `status`.
- ✳️ `follow_up_rows` gains `engagement_hospital_id` (NOT NULL, FK → hospitals), `engagement_hospital_name` (snapshot), and hospital-correction audit columns.
- ✳️ `patients` gains `procedure_hospital_id` and `default_followup_hospital_id`.

**Row-level security (RLS):**

- Patients can SELECT only rows where `patient_id = current_setting('app.current_patient_id')`.
- ✳️ Doctors can SELECT only rows for patients where they hold an **active** row in `doctor_authorizations` (or are the `primary_doctor_id`). `consult_view` doctors are further restricted to read-only and cannot see the `doctor_internal_consult` thread of patients they are not authorized on.
- ✳️ Transferred (former) doctors retain SELECT only on rows with `created_at <= transfer timestamp`.
- ✳️ Chat message visibility: `doctor_internal_consult` threads are excluded from any query executed under a `patient`/`caregiver` role.
- Applied as PostgreSQL RLS policies; the application layer sets session variables (`app.current_user_id`, `app.current_role`, `app.current_patient_id`).

### 4.6 File Storage — S3

| Bucket                                 | Purpose                                                    | Access                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `postopcare-lab-reports-{accountId}`   | Patient-uploaded lab PDFs and images                       | Private; presigned URLs (15-min TTL) for upload and download                                                                             |
| `postopcare-exports-{accountId}`       | Doctor/patient PDF chart exports                           | Private; presigned URL for download, deleted after 24h (S3 lifecycle)                                                                    |
| `postopcare-assets-{accountId}`        | Patient photos, 🆕 hospital logos, static app assets       | Private; served via CloudFront with Origin Access Control                                                                                |
| 🆕 `postopcare-chat-media-{accountId}` | Chat attachments (images/PDFs) and **voice notes** (audio) | Private; presigned upload/download (15-min TTL); virus-scanned; retained as part of the permanent EHR (7-year lifecycle, no auto-delete) |

All buckets:

- Server-side encryption: SSE-KMS.
- Versioning enabled.
- Block all public access.
- Object lifecycle: lab reports retained 7 years; exports 1 day.

**Upload flow:**

```
Patient App → POST /followup/attachments/presign
           ← 201 { uploadUrl, objectKey }
Patient App → PUT presigned URL (direct to S3, no server hop)
Patient App → POST /followup/attachments/confirm { objectKey }
           → Lambda writes attachment record to RDS
           → S3 event triggers virus-scan Lambda
```

### 4.7 File Processing — Lambda (Virus Scan)

```
S3 PutObject event (lab-reports bucket ✳️ AND chat-media bucket)
    → Lambda (Python, ClamAV layer)
        ├── Quarantine: move to -quarantine prefix, mark attachment as quarantined in RDS
        └── Clean: mark attachment as available in RDS
              ✳️ For chat media: flip chat_attachment.scan_status = clean,
                 then release the message for delivery (a message with a
                 pending attachment is held until its scan clears).
```

ClamAV definitions updated weekly via Lambda layer rebuild in CodePipeline.

### 4.8 Notification Service

Handles four channels: in-app, email, SMS, WhatsApp.

```
              ┌────────────────────────────────────────────┐
              │           SQS Queues                        │
              │                                            │
              │  notification-inapp.fifo                   │
              │  notification-email.fifo                   │
              │  notification-sms.fifo                     │
              │  notification-whatsapp.fifo                │
              │                                            │
              │  DLQ per queue (failed delivery → alert)   │
              └───────────────┬────────────────────────────┘
                              │
              ┌───────────────▼────────────────────────────┐
              │   Dispatcher Lambda (fan-out per event)     │
              │   Reads user notification preferences        │
              │   Enqueues to relevant channel queues        │
              └───────────────┬────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────┬─────────────────┐
       ▼                      ▼                  ▼                 ▼
  InApp Lambda          Email Lambda         SMS Lambda      WhatsApp Lambda
  WebSocket push        Amazon SES           MSG91 / Twilio  Meta Cloud API /
  (API Gateway WS)      (templated)          (transactional) Gupshup
  Writes to             Writes delivery      Writes delivery  Writes delivery
  notifications table   receipt → DynamoDB  receipt → DynDB  receipt → DynDB
```

**SQS FIFO queues** ensure at-most-once delivery per deduplication ID (milestone_id + reminder_type), satisfying requirement M-09 (no duplicate reminders).

**✳️ Event types feeding the dispatcher (v1.7):** in addition to `FollowUpSubmitted` and `DoctorResponded`, the dispatcher now fans out:

- `ChatMessageReceived` → push to recipient(s) via WebSocket + SMS/WhatsApp alert for `symptom_concern`-flagged messages (spec C-07).
- `DoctorAuthorized` / `AccessRevoked` → notify patient (app/SMS/WhatsApp) and the added doctor (spec T-06).
- `CaseTransferInitiated` → notify target doctor (email + in-app) with handoff summary.
- `CaseTransferCompleted` → notify patient, incoming and outgoing doctor, and care team; post a system card into the patient chat thread (spec T-12, T-13).

**Real-time in-app notifications:**

- API Gateway WebSocket endpoint: `wss://ws.postopcare.in` (shared with the Chat Engine, §4.14).
- Connection IDs stored in Redis (user_id → connectionId set) with a DynamoDB backup table for reconnection.
- InApp Lambda pushes to open connections; falls back to mark notification unread if connection closed.

### 4.9 Milestone Scheduler

Satisfies requirements M-01 to M-04.

```
EventBridge Scheduler
    ├── daily-milestone-check   cron(0 2 * * ? *)   UTC = 07:30 IST
    │       → MilestoneEvaluator Lambda
    │           Queries milestones WHERE status = 'scheduled'
    │                 AND due_date BETWEEN NOW() AND NOW() + 48h
    │           For each due reminder_schedule:
    │               Check patient timezone (default Asia/Kolkata)
    │               Enqueue to notification-sms.fifo / notification-whatsapp.fifo
    │               Update reminder_schedule.status = 'sent'
    │
    └── hourly-same-day-check   cron(0 * * * ? *)
            → MilestoneEvaluator Lambda (same, scope = same-day only)
```

**Overdue detection:**

- Second EventBridge rule runs daily at 08:30 IST.
- Marks milestones as `overdue` if due_date < NOW() and status = `scheduled`.
- Enqueues overdue reminder if not yet sent.
- Optionally enqueues doctor alert (requirement M-13, Phase 2 flag).

### 4.10 PDF Export Service

Requirement R-01: export chart as PDF matching paper layout.

```
Patient/Doctor App → POST /export/chart/:patientId
                   → Lambda (Node.js + Puppeteer headless Chrome layer)
                       Renders chart HTML template with patient data
                       Writes PDF to S3 exports bucket
                   ← 200 { downloadUrl (presigned, 24h TTL) }
```

For chart sizes > 50 rows or cold-start sensitivity: offload to Fargate task triggered via SQS with polling Lambda.

### 4.11 Audit Trail

Requirements: immutable dose change log, auth event log, reminder delivery log.

| Log type                                | Store                                     | Why                                                                     |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Dose changes                            | `dose_changes` table in Aurora RDS        | Relational queries (who, when, which patient), JOIN with follow-up rows |
| Auth events (login, logout, OTP, OAuth) | DynamoDB (`audit_auth` table)             | High write throughput; no complex joins; append-only TTL 7 years        |
| Reminder delivery receipts              | DynamoDB (`reminder_delivery` table)      | High volume per patient per milestone; write-heavy                      |
| API access log                          | API Gateway Access Logs → CloudWatch Logs | Immutable; exportable to S3 via log group export                        |
| Lambda execution log                    | CloudWatch Logs                           | Centralized; retention 365 days                                         |

DynamoDB tables use:

- On-demand billing (clinic-scale traffic).
- Point-in-time recovery enabled.
- KMS encryption.

### 4.12 Observability Stack

| Concern             | AWS Service                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Metrics             | CloudWatch Metrics (Lambda duration/error, SQS depth, RDS ACU)                                      |
| Alarms              | CloudWatch Alarms → SNS → email/PagerDuty for p99 latency, error rate, DLQ depth > 0                |
| Distributed tracing | AWS X-Ray (trace across API GW → Lambda → RDS Proxy → Aurora)                                       |
| Structured logs     | CloudWatch Logs + Log Insights queries for audit queries                                            |
| Dashboard           | CloudWatch Dashboard (key business metrics: submissions/day, notifications sent, failed deliveries) |
| Cost                | AWS Cost Explorer + Budget Alert at $X/month                                                        |

### 4.13 CI/CD Pipeline

```
GitHub (source)
    │
    ▼
CodePipeline
    ├── Source stage       GitHub webhook → CodePipeline
    ├── Build stage        CodeBuild
    │       Frontend:      npm ci, test, build → upload to S3 → CloudFront invalidation
    │       Backend:       npm ci, test, zip → Lambda deployment packages
    │       DB migration:  Flyway migrate → RDS (pre-deploy)
    ├── Test stage         CodeBuild: integration tests against staging environment
    └── Deploy stage       CloudFormation / CDK changeset → apply to prod
```

Infrastructure as Code: **AWS CDK (TypeScript)** — all resources defined as code, reviewed in PRs, deployed via CodePipeline.

---

### 🆕 4.14 Conversational Chat Engine (spec §7.8)

Real-time, HIPAA/PHI-compliant messaging between the patient/caregiver and the authorized care team, plus a private doctor-to-doctor consult thread.

```
                ┌──────────────────────────────────────────────────┐
                │  API Gateway WebSocket API (wss://ws.postopcare.in)│
                │  Routes: $connect / $disconnect / sendMessage /    │
                │          markRead / typing                         │
                └───────────────┬───────────────────────────────────┘
                                │  (JWT validated on $connect)
                ┌───────────────▼───────────────────────────────────┐
                │  Chat Lambda(s)                                    │
                │   • Persist ChatMessage → Aurora (RLS enforced)    │
                │   • Store attachment/voice metadata → chat_attach  │
                │   • Presign chat-media upload/download (S3)        │
                │   • Update read_by_user_ids; emit read receipts    │
                │   • Post system event cards (submission, dose      │
                │     change, transfer) into the thread              │
                │   • Publish ChatMessageReceived → SQS (fan-out)    │
                └───────────────┬───────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────────────┐
        ▼                       ▼                               ▼
  Redis (conn map)       Aurora (transcript,          Notification Dispatcher
  user_id→connIds        immutable, append-only)      (offline push: SMS/WA/
  + DynamoDB backup                                    email; symptom_concern
                                                       triage alert)
```

| Concern          | Decision                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport        | API Gateway **WebSocket API** — managed, scales connections, integrates with Lambda; no self-managed socket servers                                             |
| Persistence      | Transcript in Aurora (`chat_messages`, `chat_attachments`); **immutable** — no user UPDATE/DELETE (spec C-10); enforced by RLS + revoke of UPDATE/DELETE grants |
| Media            | Voice notes and attachments in `postopcare-chat-media` S3 bucket; presigned upload; virus-scanned before release                                                |
| Delivery state   | `read_by_user_ids[]` maintained per message; receipts pushed over WebSocket (spec C-05)                                                                         |
| Offline delivery | If recipient has no open connection, the `ChatMessageReceived` event triggers a push/SMS/WhatsApp alert with a deep link (no PHI in the message body)           |
| Internal consult | `doctor_internal_consult` thread hidden from patient at the RLS layer (spec C-08)                                                                               |
| Latency target   | < 1 s end-to-end (matches spec NFR)                                                                                                                             |
| Phase split      | MVP: text + image/PDF attachments + patient↔care-team thread. Phase 2: voice notes, internal consult thread, audio transcription (spec §13–14)                 |

### 🆕 4.15 Care Team Authorization & Case Transfer Service (spec §7.9)

Governs which doctors can act on a patient and the formal handoff of primary ownership.

```
Doctor/Admin App
  → POST /care-team/grant        (CareTeamService Lambda)
        INSERT doctor_authorizations (access_level, expires_at, status=active)
        Publish DoctorAuthorized → SQS  → notify patient + added doctor
  → DELETE /care-team/grant/:id  → status=revoked, revoked_at/by
  → POST /transfers              (CaseTransferService Lambda)
        INSERT case_transfer_log (status=pending, handoff_note)
        Publish CaseTransferInitiated → notify target doctor
  → POST /transfers/:id/accept   → UPDATE patients.primary_doctor_id
        Reassign outgoing doctor role (co_managing | transferred read-only)
        Append immutable entry; Publish CaseTransferCompleted
        (patient + team notified; system card posted to chat)
  → POST /admin/transfers/:id/force  → Admin override (no target accept)
```

| Concern            | Decision                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expiry enforcement | A daily EventBridge rule (reuses the milestone scheduler cadence) flips time-bound `consult_view` grants to `status=expired` (spec T-03)                                                |
| Consistency        | Ownership transfer wrapped in a single DB transaction (patient row + authorization rows + transfer log) to avoid split state                                                            |
| Audit              | `case_transfer_log` and `doctor_authorizations` are append-only history; role changes never overwrite prior records (spec T-14)                                                         |
| Access recompute   | On any grant/revoke/transfer, the RLS-backing view of "doctors authorized for patient X" reflects the change on the next request; sessions carry only identity, not cached patient ACLs |

### 🆕 4.16 Hospital Registry Service (spec §7.0, v1.7)

Admin-managed directory of facilities plus doctor affiliations and the system-seeded Virtual Hospital.

```
Admin App
  → POST/PUT/PATCH /admin/hospitals            (HospitalService via AdminService)
        Create/edit/deactivate hospital (code immutable after create)
        Logo upload → postopcare-assets bucket (presigned)
  → POST /admin/hospitals/:id/affiliations     add doctor↔hospital
Doctor App
  → GET  /hospitals?scope=affiliated           picker source (own active affiliations)
Patient/Doctor App (new engagement)
  → GET  /hospitals?forPatient=:id             affiliated hospitals of patient's
                                               primary doctor + Virtual (pinned)
```

| Concern               | Decision                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtual Hospital      | Seeded row (`hospital_code=VIRTUAL`, well-known UUID); cannot be edited/deactivated; always first in picker                                                                       |
| Referential integrity | `engagement_hospital_id` on `follow_up_rows` is `NOT NULL` with FK to `hospitals`; a **name snapshot** column keeps historical rows readable if a hospital is renamed/deactivated |
| Caching               | The (small, bounded) hospital list is cached in Redis and client-side for offline chart rendering; picker search target < 300 ms (spec NFR)                                       |
| Data residency        | Hospital records are non-PHI reference data but still reside in ap-south-1 with the rest of the stack                                                                             |
| Deactivation safety   | Deactivating a hospital removes it from pickers but never mutates historical engagement rows                                                                                      |

---

## 5. AWS Region & Availability Strategy

| Dimension         | Decision                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Primary region    | **ap-south-1 (Mumbai)** — data residency, low latency for India users                                                         |
| AZ redundancy     | All stateful services span 2 AZs (Aurora Multi-AZ, RDS Proxy, Redis Serverless)                                               |
| Disaster recovery | Tier: Backup & Restore — daily Aurora snapshots cross-copied to ap-southeast-1 (Singapore); RTO ~4h, RPO ≤ 24h (matches spec) |
| CDN               | CloudFront global PoPs; origin in ap-south-1                                                                                  |

---

## 6. Security Architecture

```
Internet
    │
    ▼
Route 53 → CloudFront + WAF
    │
    ▼
API Gateway (HTTP API)
    │    JWT Authorizer (Lambda) — validates session from Redis
    │    TLS 1.2+ enforced
    ▼
VPC (private subnets only for compute & data)
    │
    ├── Lambda functions (in VPC attachment)
    │       IAM execution role — least privilege
    │       No hardcoded credentials (Secrets Manager)
    │
    ├── RDS Proxy → Aurora PostgreSQL
    │       Security group: allow 5432 from Lambda SG only
    │       TLS in transit enforced
    │       KMS encryption at rest
    │
    ├── ElastiCache Redis Serverless
    │       Security group: allow 6379 from Lambda SG only
    │       TLS in transit enforced
    │       Encryption at rest
    │
    └── S3 Buckets
            Block public access: ON
            Bucket policies: deny non-HTTPS
            Presigned URLs: 15-min TTL
            SSE-KMS
```

**PHI boundary:** No PHI in SMS/WhatsApp message body (per spec §7.6.4). Message templates contain only due date, app name, and deep link. ✳️ The same rule applies to **chat push/SMS/WhatsApp alerts** — the notification body carries only "New message from your care team" plus a deep link; message content stays inside the authenticated app.

**RBAC enforcement layers (✳️ updated for v1.7):**

1. JWT Authorizer rejects invalid/expired sessions (applies to both the HTTP API and the WebSocket `$connect` route).
2. Lambda checks the `role` claim before executing any operation.
3. **✳️ Care-team authorization check** — for any doctor operation on a patient, the service confirms an active row in `doctor_authorizations` (or `primary_doctor_id` match) at the correct `access_level` before proceeding (e.g. `consult_view` cannot prescribe or post to the patient thread).
4. PostgreSQL RLS enforces data-row ownership, including the transferred-doctor time bound and the patient-invisible internal consult thread.
5. **🆕 Hospital scoping** — hospital pickers only return facilities the acting doctor is affiliated with; the API rejects an `engagement_hospital_id` that is neither the Virtual Hospital nor an active affiliation of the patient's primary doctor.

**Secrets management:**

- Google/X OAuth client secrets → Secrets Manager, auto-rotated.
- JWT signing key → Secrets Manager.
- DB credentials → Secrets Manager (RDS Proxy native integration).
- SMS/WhatsApp API keys → Secrets Manager.

---

## 7. Component Interaction — Key Flows

### 7.1 Patient submits a follow-up

```
Patient App (SPA)
  → POST /followup/rows          (API GW → FollowUp Lambda)
        Validates schema, inserts FollowUpRow (status=pending)
        Publishes FollowUpSubmitted event → SQS notification queue
        Updates Milestone.status = submitted
        Cancels pending ReminderSchedules for that milestone (M-10)
  ← 201 { rowId }

Notification Dispatcher Lambda (SQS trigger)
  → Looks up assigned doctors
  → Enqueues to notification-inapp.fifo (doctor WebSocket push)
  → Enqueues to notification-email.fifo (doctor email via SES)
```

### 7.2 Doctor publishes response

```
Doctor App (SPA)
  → PUT /followup/rows/:id/response  (API GW → DoseService Lambda)
        Writes DoseChange records (old→new, doctor_id, timestamp)
        Writes DoctorResponse record
        Updates FollowUpRow.status = reviewed
        Computes next follow-up milestone due date
        Inserts new Milestone + ReminderSchedules (M-02)
        Publishes DoctorResponded event → SQS
  ← 200 { responseId }

Notification Dispatcher Lambda
  → Enqueues notification-inapp (patient), notification-email, notification-sms, notification-whatsapp
```

### 7.3 Milestone reminder delivery

```
EventBridge cron (daily 07:30 IST)
  → MilestoneEvaluator Lambda
        SELECT milestones WHERE due_date BETWEEN now() AND now()+48h
        For each milestone: SELECT reminder_schedules WHERE status=pending
        Check patient reminder_preferences
        Enqueue to notification-sms.fifo and/or notification-whatsapp.fifo
        UPDATE reminder_schedule.status = sent

SMS Lambda (SQS trigger, notification-sms.fifo)
  → Format template (no PHI)
  → Call MSG91 / Twilio API
  → INSERT ReminderDelivery (channel=sms, delivery_status=sent)
  → On webhook callback: UPDATE delivery_status=delivered|failed

WhatsApp Lambda (SQS trigger, notification-whatsapp.fifo)
  → Format approved template
  → Call Meta Cloud API / Gupshup
  → INSERT ReminderDelivery (channel=whatsapp)
```

### 🆕 7.4 Patient sends a chat message (spec §7.8, §8.5)

```
Patient App
  → WebSocket sendMessage { threadId, text | voiceObjectKey | attachmentKey, urgency_flag }
        Chat Lambda validates care-team membership (RLS + authz)
        INSERT chat_messages (immutable); link attachment/voice metadata
        Publish ChatMessageReceived → SQS
  ← ack + message id (over WebSocket)

Notification Dispatcher
  → For each authorized doctor with an open WS connection: push message
  → For offline recipients: enqueue push/SMS/WhatsApp alert (no PHI body)
  → If urgency_flag = symptom_concern: highlight on doctor dashboard + priority alert
```

### 🆕 7.5 Primary doctor grants consulting access (spec §7.9.2, §8.6)

```
Primary Doctor App
  → POST /care-team/grant { doctorId, access_level=consult_view, expires_at }
        CareTeamService INSERT doctor_authorizations (status=active)
        Publish DoctorAuthorized → SQS
  ← 201

Notification Dispatcher
  → Notify added doctor ("You joined Raghavendra's care team")
  → Notify patient ("Dr. Barun joined your care team as Consultant") app/SMS/WhatsApp
```

### 🆕 7.6 Primary case transfer (spec §7.9.3, §8.7)

```
Outgoing Primary App
  → POST /transfers { targetDoctorId, handoff_note }
        INSERT case_transfer_log (status=pending)
        Publish CaseTransferInitiated → notify target doctor
Incoming Primary App
  → POST /transfers/:id/accept
        BEGIN TX
          UPDATE patients.primary_doctor_id = target
          Reassign outgoing doctor (co_managing | transferred read-only)
          UPDATE case_transfer_log (status=accepted, responded_at)
        COMMIT
        Publish CaseTransferCompleted
  → Notify patient + incoming + outgoing + care team
  → Chat Lambda posts system card into patient thread
        ("Primary care transferred from Dr. Dey to Dr. Tejai B")
```

### 🆕 7.7 New engagement with hospital selection (spec §7.0, §8.8)

```
Patient App (tap "Add New Follow-Up")
  → GET /hospitals?forPatient=:id
        HospitalService returns primary doctor's active affiliations
        + Virtual Hospital (pinned first), served from Redis cache
  ← [ Virtual, SHMS, AIIMS-DEL, ... ]
Patient App
  → POST /followup/rows { engagement_hospital_id, ...labs, doses }
        FollowUpService validates hospital_id is non-null and permitted
        Snapshots hospital name into engagement_hospital_name
        INSERT follow_up_row (status=pending)
        Publish FollowUpSubmitted (event card includes hospital name)
  ← 201 { rowId }
```

---

## 8. Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        AWS Cloud ap-south-1                                │
│                                                                            │
│  ┌──────────────┐     ┌──────────────────────────────────────────────┐    │
│  │  CloudFront  │────►│  API Gateway (HTTP API + WebSocket API)       │    │
│  │  + WAF       │     └──────────────┬───────────────────────────────┘    │
│  │  (SPA serve) │                    │                                    │
│  └──────────────┘                    │  JWT Authorizer Lambda              │
│                                      ▼                                    │
│                      ┌───────────────────────────────────────────┐        │
│                      │           Application Lambdas              │        │
│                      │  Auth | FollowUp | Dose | Milestone |      │        │
│                      │  Notification | Admin | Export             │        │
│                      └───┬──────────┬──────────┬─────────────────┘        │
│                          │          │          │                           │
│               ┌──────────▼──┐  ┌────▼────┐  ┌─▼──────────────┐           │
│               │ Aurora RDS  │  │  Redis  │  │  S3 Buckets    │           │
│               │ (PostgreSQL │  │  (cache)│  │  (files)       │           │
│               │  Serverless)│  └─────────┘  └────────────────┘           │
│               └─────────────┘                                             │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  Event Bus / Queues                                               │     │
│  │  SQS FIFO (inapp, email, sms, whatsapp)  ◄── Application Lambda  │     │
│  │      │                                                            │     │
│  │      ├── InApp Lambda  ──► API GW WebSocket ──► Patient/Doctor    │     │
│  │      ├── Email Lambda  ──► Amazon SES                             │     │
│  │      ├── SMS Lambda    ──► MSG91 / Twilio   ──► Patient phone     │     │
│  │      └── WA Lambda     ──► Meta Cloud API   ──► Patient WhatsApp  │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│  ┌───────────────────────────────────────────────────┐                    │
│  │  EventBridge Scheduler ──► MilestoneEvaluator Lambda               │   │
│  │  (daily 07:30 IST + hourly)  ──► SQS notification queues          │   │
│  └───────────────────────────────────────────────────┘                    │
│                                                                            │
│  ┌───────────────────────────────────────────────────┐                    │
│  │  DynamoDB                                          │                   │
│  │  audit_auth | reminder_delivery                   │                   │
│  └───────────────────────────────────────────────────┘                    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Service Sizing & Cost Estimate (Reference)

Assumptions: ~50 active patients, ~5 doctors, ~200 follow-up submissions/month, ~500 reminder SMS+WhatsApp/month.

| Service                              | Tier                                                  | Est. monthly cost (USD) |
| ------------------------------------ | ----------------------------------------------------- | ----------------------- |
| Aurora PostgreSQL Serverless v2      | 0.5–2 ACU, 20 GB storage                              | ~$30–50                 |
| Lambda                               | ~10k invocations/month                                | < $1                    |
| API Gateway (HTTP API)               | ~50k requests/month                                   | < $1                    |
| 🆕 API Gateway WebSocket             | Chat + in-app; low connection-minutes at clinic scale | < $2                    |
| 🆕 S3 chat-media (voice/attachments) | < 2 GB, retained                                      | ~$1                     |
| ElastiCache Redis Serverless         | < 1 GB data, low requests                             | ~$10                    |
| S3 + CloudFront                      | < 5 GB storage, < 10 GB transfer                      | ~$5                     |
| SES (email)                          | ~500 emails/month                                     | < $1                    |
| SQS FIFO                             | ~5k messages/month                                    | < $1                    |
| EventBridge Scheduler                | ~60 invocations/month                                 | < $1                    |
| DynamoDB (on-demand)                 | < 1 GB, low WCU                                       | < $5                    |
| CloudWatch                           | Logs, metrics, alarms                                 | ~$5                     |
| **SMS / WhatsApp**                   | External (MSG91/Twilio + Meta)                        | ~$20–40                 |
| **Total AWS**                        |                                                       | ~$58–85/month           |

_SMS/WhatsApp costs are external and volume-dependent. Indian DLT-registered SMS via MSG91 ~₹0.15–0.25/SMS._

---

## 10. Technology Stack Summary

| Layer                                 | Technology                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| **Frontend**                          | React 18, TypeScript, TailwindCSS, React Query                                  |
| **API runtime**                       | Node.js 22 (Lambda)                                                             |
| **Database**                          | PostgreSQL 16 (Aurora Serverless v2)                                            |
| **Cache / sessions**                  | Redis 7 (ElastiCache Serverless)                                                |
| **Object storage**                    | Amazon S3                                                                       |
| **CDN / edge**                        | Amazon CloudFront + AWS WAF                                                     |
| **DNS**                               | Amazon Route 53                                                                 |
| **Auth (OAuth broker)**               | AWS Lambda (custom, no Cognito — X OAuth not supported natively)                |
| **Email**                             | Amazon SES                                                                      |
| **SMS**                               | MSG91 (India DLT registered) or Twilio                                          |
| **WhatsApp**                          | Meta Cloud API or Gupshup (approved templates)                                  |
| **Scheduler**                         | Amazon EventBridge Scheduler                                                    |
| **Message queues**                    | Amazon SQS FIFO                                                                 |
| **🆕 Real-time chat / notifications** | API Gateway WebSocket API + Lambda; connection state in Redis (DynamoDB backup) |
| **🆕 Chat transcript**                | Aurora PostgreSQL (immutable); media in S3 (`chat-media` bucket)                |
| **Audit log**                         | Amazon DynamoDB + CloudWatch Logs                                               |
| **PDF export**                        | AWS Lambda + Puppeteer (Chromium layer)                                         |
| **IaC**                               | AWS CDK (TypeScript)                                                            |
| **CI/CD**                             | AWS CodePipeline + CodeBuild                                                    |
| **Secrets**                           | AWS Secrets Manager                                                             |
| **Observability**                     | CloudWatch Metrics, Logs, Alarms, X-Ray                                         |

---

## 11. Key Architecture Decisions & Tradeoffs

### ADR-01: No AWS Cognito for Authentication

**Decision:** Custom Lambda-based auth service.

**Reason:** X (Twitter) OAuth 2.0 is not a Cognito federated identity provider. Building custom auth is more work but provides full control over all three methods (Google, X, SMS OTP) in a unified `AuthIdentity` model matching the spec.

**Tradeoff:** Team owns session management and OTP security. Mitigated by strict adherence to spec §12.10 security requirements and use of Redis for token storage.

---

### ADR-02: Aurora Serverless v2 over RDS Provisioned

**Decision:** Aurora Serverless v2.

**Reason:** Clinic-scale traffic is bursty and low overall. Serverless v2 scales to zero ACUs during off-hours and costs ~$30/month vs ~$80+ for smallest provisioned instance. PostgreSQL dialect satisfies complex RLS, JSONB for lab values, and audit queries.

**Tradeoff:** ~1–2s cold-start latency on scale-from-zero. Mitigated by minimum 0.5 ACU setting.

---

### ADR-03: SQS FIFO for Notification Deduplication

**Decision:** FIFO queues with `messageDeduplicationId = milestoneId + reminderType`.

**Reason:** Spec requirement M-09 (no duplicate reminders). FIFO guarantees exactly-once delivery within a 5-minute deduplication window, preventing double-send even on Lambda retry.

---

### ADR-04: DynamoDB for Audit Logs vs Relational

**Decision:** DynamoDB for auth events and reminder delivery receipts; PostgreSQL for dose change audit.

**Reason:** Dose change audit requires JOINs with patient/doctor/row data → relational is natural. Auth and reminder delivery are high-volume, append-only, query-by-id → DynamoDB's pay-per-use and TTL are optimal.

---

### ADR-05: Region ap-south-1 (Mumbai)

**Decision:** All services in ap-south-1.

**Reason:** Patient data (PHI) subject to India's DPDP Act. Keeping all data and compute in-region satisfies data residency requirements without cross-region data flows.

---

### 🆕 ADR-06: API Gateway WebSocket for Chat (not AppSync / self-managed)

**Decision:** Use API Gateway WebSocket API for both chat and in-app notifications, backed by Lambda and Aurora.

**Reason:** The team already operates API Gateway + Lambda; reusing that stack keeps one auth model (JWT on `$connect`) and one deployment path. AppSync (GraphQL subscriptions) would add a second data-access paradigm for a modest feature set, and self-managed socket servers on Fargate would break the serverless-first principle for clinic-scale traffic.

**Tradeoff:** API Gateway WebSocket has a 2-hour idle connection cap and per-message Lambda cost; acceptable at this scale. Connection state is kept in Redis with a DynamoDB backup for reconnection.

---

### 🆕 ADR-07: Chat transcript in Aurora with enforced immutability

**Decision:** Persist chat messages in Aurora (`chat_messages`) rather than DynamoDB, and revoke UPDATE/DELETE at the DB grant level.

**Reason:** Chat is part of the permanent EHR (spec C-10) and needs relational context — linking messages to follow-up rows, dose changes, and care-team roles under the same RLS model as clinical data. Immutability is enforced by granting only INSERT/SELECT to the application role.

**Tradeoff:** Higher write cost than DynamoDB, but volume is low and consistency with clinical data matters more. Media blobs live in S3, not the row.

---

### 🆕 ADR-08: Denormalized hospital-name snapshot on follow-up rows

**Decision:** Store `engagement_hospital_id` (FK) **and** an `engagement_hospital_name` snapshot on each follow-up row.

**Reason:** Hospitals can be renamed or deactivated over a patient's multi-year record. The FK preserves referential integrity and filtering; the snapshot guarantees historical rows and exported PDFs remain accurate to what was true at submission time.

**Tradeoff:** Minor denormalization/storage cost, accepted for audit fidelity and offline chart rendering.

---

## 12. MVP Delivery Scope (Architecture Readiness)

The following architecture components are required for Phase 1 / MVP (matching spec §14):

| Component                                                                | MVP Required | Notes                                   |
| ------------------------------------------------------------------------ | ------------ | --------------------------------------- |
| React SPA on S3 + CloudFront                                             | ✅           | Patient + Doctor portals                |
| API Gateway + Core Lambdas                                               | ✅           | All clinical CRUD                       |
| Auth Lambda (Google + X + SMS OTP)                                       | ✅           | Per spec §12                            |
| Aurora PostgreSQL Serverless v2                                          | ✅           | All relational data                     |
| Redis (ElastiCache Serverless)                                           | ✅           | Sessions, OTP, rate limits              |
| S3 lab report storage + presigned upload                                 | ✅           | File upload per P-03                    |
| Virus scan Lambda                                                        | ✅           | Security requirement                    |
| SES email notifications                                                  | ✅           | Replace email loop                      |
| SQS + SMS Lambda (MSG91/Twilio)                                          | ✅           | MVP reminder channel                    |
| SQS + WhatsApp Lambda (Meta API)                                         | ✅           | MVP reminder channel                    |
| EventBridge Scheduler + MilestoneEvaluator                               | ✅           | Core milestone automation               |
| DynamoDB audit tables                                                    | ✅           | Audit trail                             |
| PDF export Lambda                                                        | ✅           | R-01 export                             |
| WebSocket (in-app notifications ✳️ + chat)                               | ✅           | Real-time doctor alert + chat transport |
| 🆕 Chat Engine — text + image/PDF attachments, patient↔care-team thread | ✅           | Spec §7.8 (MVP subset)                  |
| 🆕 Chat — voice notes + internal consult thread + transcription          | 🔜 Phase 2   | Spec §13–14 phase split                 |
| 🆕 Care Team authorization (co-managing / consulting grants)             | ✅           | Spec §7.9.2                             |
| 🆕 Primary case transfer (with accept + admin force)                     | ✅           | Spec §7.9.3                             |
| 🆕 Hospital Registry + doctor affiliations + Virtual Hospital            | ✅           | Spec §7.0 (v1.7)                        |
| 🆕 Engagement-level hospital association on follow-up rows               | ✅           | Spec §7.2 (required field)              |
| 🆕 Hospital-filtered doctor dashboard                                    | ✅           | Spec D-13                               |
| 🆕 Per-hospital reporting                                                | 🔜 Phase 2   | Spec R-04                               |
| CDK IaC + CodePipeline                                                   | ✅           | Deployment automation                   |
| CloudWatch alarms                                                        | ✅           | Operational visibility                  |
| Trend graphs / push notifications                                        | 🔜 Phase 2   |                                         |
| EHR/LIS integration                                                      | 🔜 Phase 3   |                                         |
| OCR from lab PDFs                                                        | 🔜 Phase 3   |                                         |

---

## 13. Open Architecture Questions (Mapped to Spec §17)

| Spec Q#                                    | Architecture impact                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Q9 — SMS provider                          | Determines SMS Lambda integration (MSG91 preferred for India DLT compliance)                              |
| Q11 — WhatsApp provider                    | Determines WhatsApp Lambda integration (Meta Cloud API or Gupshup)                                        |
| Q5 — WhatsApp templates                    | Pre-approved template IDs must be configured in Secrets Manager before launch                             |
| Q6 — Regulated device                      | If classified as SaMD in India, data retention and audit requirements may tighten                         |
| Q12 — Default protocol                     | Drives seed data for `follow_up_protocols` table and EventBridge schedule cadence                         |
| Q13 — Overdue escalation to doctor         | Simple: extend MilestoneEvaluator to enqueue a notification-inapp/email for doctor                        |
| ✳️ Q14 — Voice note duration cap           | Sets max object size for chat-media bucket + client recorder limit (60/120s)                              |
| ✳️ Q15 — Transfer acceptance policy        | Chosen model (accept-required + admin force) drives CaseTransferService state machine                     |
| ✳️ Q16 — Symptom-concern alerting          | If yes, ChatMessageReceived with `symptom_concern` triggers direct SMS/push to on-duty doctor             |
| 🆕 Q17 — Hospital affiliation self-service | If doctors self-request affiliations, add an approval workflow + status to `hospital_doctor_affiliations` |
| 🆕 Q18 — Patient-suggested hospitals       | If disallowed (recommended), picker stays read-only; no write path from patient to `hospitals`            |
| 🆕 Q19 — Multi-region hospital lists       | If multi-city/country, add city/country filters to picker + registry indexes                              |
| 🆕 Q20 — Procedure-hospital mutability     | Admin-only correction path with audit entry if `procedure_hospital_id` can change                         |
| 🆕 Q21 — Legacy row hospital backfill      | Migration strategy for pre-v1.7 rows (recommended: default to `VIRTUAL`, admin bulk-update)               |

---

_End of HLD document — v2.0, aligned to Application Specification v1.7_
