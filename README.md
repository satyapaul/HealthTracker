# HealthTracker

A digital replacement for the paper flowchart that post-operative transplant
patients use to track lab results and immunosuppressant doses. It closes the
loop between patients and their care team, adds secure clinical chat, and ties
every follow-up to a hospital.

## What it does

**For patients and caregivers.** After surgery, a patient records each dated
follow-up — lab values, drug levels, current doses, weight, and lab-report
uploads — straight from their phone or the web, instead of carrying a paper
chart between visits. They pick the hospital for each engagement, submit the
entry for review, and see the doctor's response: adjusted doses (clearly marked
when changed), additional tests requested, and clinical remarks. Between
submissions, patients and their care team stay in touch through an integrated,
immutable chat thread, and automated SMS/WhatsApp reminders keep follow-ups on
schedule.

**For doctors.** A clinician sees each assigned patient's history as a
longitudinal flow chart — parameters down the side, submission dates across the
top, with out-of-range values highlighted — so trends are obvious at a glance.
From there a doctor reviews a pending submission, prescribes or adjusts doses
(every change is logged to an immutable audit trail), requests further tests,
and replies. Any doctor can onboard, affiliate with one or more hospitals, and
stay connected to their patients; multiple doctors can collaborate on a case,
and primary ownership can be formally transferred with a full audit trail.

Access is least-privilege and enforced at both the API and the database, so a
clinician only ever sees the patients they are authorized for, and a patient
only ever sees their own record.

## High-level architecture

HealthTracker is a TypeScript monorepo (npm workspaces):

- **`apps/web`** — a React single-page app (Vite) serving the patient, doctor,
  and admin experiences. It is a single responsive website: a mobile layout
  with a bottom-tab nav and a desktop layout with a sidebar. Branding (name,
  colors, logo) is config-driven, not hardcoded.
- **`apps/api`** — the backend as per-domain functions (auth, patient,
  follow-up, dose review, hospital, chat, notifications, …) designed to run as
  AWS Lambda behind API Gateway. Each function is written against clean
  **ports** (DB, cache, storage, secrets) with the real adapters injected at
  deploy time, so the business logic is unit-tested in isolation with in-memory
  fakes.
- **`infra`** — AWS CDK (TypeScript) describing the target cloud: PostgreSQL
  (Aurora Serverless v2) with Row-Level Security, Redis for sessions/OTP/rate
  limits, S3 for uploads, SQS/SNS/EventBridge for the notification pipeline, and
  a CloudFront/WAF edge. PHI data stays in region (ap-south-1).
- **`db`** — Flyway SQL migrations (the schema + RLS policies).

**Auth** is identity-first: Google / X OAuth or SMS OTP issues an opaque session
token validated at the API Gateway authorizer, and the resolved role drives
which portal and data the user can reach. Every response uses one envelope
(`{ success, data, error }`).

### Running the demo

A single Node process can serve the built SPA plus a **seeded in-memory API**
from one origin — no AWS, no database — for sharing and review. See
[`DEMO.md`](./DEMO.md) for one-command local run and one-click deploy (Render).
Demo data resets on restart.
