# Product

Post-Operative Investigation Follow-Up Platform — a digital replacement for the paper
flowchart transplant patients use to track post-op lab results and immunosuppressant
doses. It automates the patient→doctor follow-up loop, adds secure clinical chat,
multi-doctor collaboration and case transfer, and ties every engagement to a hospital.

Full requirements: `docs/application-specification.md` (spec v1.7).

## Core loop

Patient submits a dated follow-up row (labs, drug levels, current doses, weight, lab-report
uploads) → doctor reviews, prescribes/adjusts doses, replies → patient sees the response.
Between rows, patient and care team communicate via integrated chat. Automated SMS/WhatsApp
reminders keep patients on schedule.

## Users

- **Patient / Caregiver** — enters data, uploads reports, reads doctor responses, chats, picks hospital per engagement.
- **Primary Doctor** — owns the case; reviews, prescribes, authorizes other doctors, transfers ownership.
- **Co-Managing / Consulting Doctor** — edit-and-prescribe vs. view-only care-team roles.
- **Admin** — onboards patients, manages doctor accounts and the hospital registry (website-only for MVP).

## Key domains

- **Clinical flowchart** — patient chart header + dated follow-up rows (full field catalog in spec §7.2.1).
- **Hospital Registry (v1.7)** — admin-managed facilities, doctor–hospital affiliations, a system-seeded Virtual Hospital; every follow-up row carries a required `engagement_hospital_id`.
- **Conversational chat** — patient↔care-team + private doctor consult thread; immutable transcript.
- **Care team & case transfer** — authorization grants and formal primary-ownership handoff with audit trail.
- **Notifications** — in-app, email, SMS, WhatsApp.

## Surfaces (multi-surface, one API)

Native iOS app, native Android app, and one responsive website (desktop + mobile web).
The Admin console is website-only for MVP. MVP feature parity across all surfaces for core flows.

## Non-negotiables

- **PHI residency** — all PHI stays in AWS ap-south-1 (Mumbai).
- **Auditability** — every dose change, chat message, authorization grant, and case transfer is immutably logged.
- **Least-privilege access** — enforced at both API and data (RLS) layers.
- **Configurable branding (🎨)** — app name, website name, logos, colors, and copy are driven by
  configuration/theming and changeable without code changes. The product name is **undecided**;
  do not hardcode a brand name in business logic. (A "RecoverEase" mock exists but is not final.)

CX mockups for the key screens live in `CX-mocks/`.
