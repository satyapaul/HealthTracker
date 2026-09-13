# Development Guidance — Post-Operative Follow-Up Platform

**Purpose:** A step-by-step, agent-driven development plan for building the platform described in `post_op_follow_up_platform_spec_v1.7.md`, grounded in the existing HLD (`HLD-AWS-Architecture.md`) and LLD (`docs/LLD-Technical-Design.md`).

**Development style:** Agent-based development with evaluation gates. Every unit of work is executed by a coding agent against an explicit, machine-checkable specification, then verified by an evaluation step (automated tests + an evaluator agent + a human review gate) before it is accepted.

---

## 0. How to Read This Plan

- **Phases** group related work and end in a demoable, evaluated milestone.
- **Work packages (WPs)** are the smallest unit an agent picks up. Each has: an objective, inputs, a definition of done (DoD), and an evaluation method.
- **Every WP is gated.** No WP is "done" until its evaluation passes. This is the core of agent-based development: the agent proposes, the evaluator disposes.
- **Traceability:** Each WP references the spec section(s) it implements (e.g. `SPEC §7.0`) so acceptance criteria map back to requirements.

---

## 1. Target Architecture Recap (from HLD/LLD)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React (web) in `apps/web` | Patient, Doctor, Admin portals |
| API | Node.js 22 on AWS Lambda in `apps/api/functions` | One function domain per folder (auth, patient, dose, followup, notification, milestone, export, websocket, admin, virus-scan) |
| Shared code | `apps/api/layers/common/nodejs` | Lambda layer for shared utils, db client, auth middleware |
| Data | PostgreSQL 16 on Aurora Serverless v2 | Row-Level Security enforces per-patient access |
| Cache/session | Redis (ElastiCache) | Sessions, OTP, hospital-list cache |
| Storage | S3 | Lab report uploads, chat attachments, voice notes, hospital logos |
| Messaging | SQS/SNS/EventBridge | Notification pipeline, milestone scheduler |
| Infra | AWS CDK + CloudFormation in `infra/` | `cfn-01…07` stacks + CDK constructs |
| Region | ap-south-1 (Mumbai) | PHI data residency |

**Hospital feature (v1.7) additions that thread through every layer:** `hospitals` table, `hospital_doctor_affiliations` table, `engagement_hospital_id` on follow-up rows, hospital picker UI, hospital-filtered dashboard, admin hospital management.

---

## 2. Phased Development Plan

Each phase ends in an evaluated, demoable milestone. Work packages (WPs) inside a phase can be parallelized across agents where dependencies allow.

### Phase 0 — Foundations & Guardrails
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 0.1 | Monorepo tooling: workspaces, TypeScript, ESLint, Prettier, Vitest/Jest, commit hooks | — | `npm ci && npm run lint && npm test` green on empty scaffolds |
| 0.2 | CI pipeline skeleton (build, lint, test, IaC synth) | HLD §4.13 | PR triggers pipeline; red on failure |
| 0.3 | CDK bootstrap + base network stack (`cfn-01`), secrets, KMS | HLD §4.1, §6 | `cdk synth` clean; `cdk deploy` to sandbox succeeds |
| 0.4 | DB migration harness (Flyway) + base schema (users, auth) | LLD §1 | Migrations apply to a throwaway Aurora; rollback tested |

### Phase 1 — Auth & Identity
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 1.1 | Auth Lambda: Google OAuth, X OAuth, SMS OTP, JWT sessions in Redis | SPEC §12, HLD §4.3 | All three sign-in methods reach correct portal; audit rows written |
| 1.2 | JWT authorizer + role claims on API Gateway | HLD §4.4, §6 | Expired/revoked sessions rejected pre-Lambda |
| 1.3 | RLS policies + session variables (`app.user_id`, `app.role`, `app.patient_id`) | HLD §4.5 | Cross-patient access denied in integration tests |

### Phase 2 — Core Clinical Flowchart
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 2.1 | Patient/chart CRUD + header fields incl. procedure/default hospital | SPEC §7.1 | Chart create/read with all header fields |
| 2.2 | Follow-up row submit with full field catalog | SPEC §7.2.1 | All fields (Hb→Comments) persist; partial entry allowed |
| 2.3 | Doctor review: prescribed doses, dose-change audit, doctor response | SPEC §7.2, §7.4 | Dose changes visibly distinct + audit rows |
| 2.4 | Lab report upload (presigned S3 + virus scan) | SPEC §7.3, HLD §4.6-4.7 | Quarantine flow verified with EICAR test file |

### Phase 3 — Hospital Registry (v1.7)
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 3.1 | `hospitals` + `hospital_doctor_affiliations` schema + Virtual Hospital seed | SPEC §7.0.1-7.0.2 | Virtual record present, non-deletable |
| 3.2 | Admin hospital CRUD + affiliation management | SPEC §7.0.3 H-01…H-06 | Deactivation does not mutate historical rows |
| 3.3 | Hospital picker API + required `engagement_hospital_id` on rows | SPEC §7.2, §7.0.3 H-07 | Submission rejected without hospital; name snapshot stored |
| 3.4 | Hospital-filtered doctor dashboard | SPEC D-13 | Filter returns only patients with a matching engagement |

### Phase 4 — Notifications & Milestones
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 4.1 | Notification dispatcher + SQS FIFO channels (in-app/email/SMS/WhatsApp) | HLD §4.8 | No duplicate sends (dedup id verified) |
| 4.2 | Milestone scheduler + reminder cancellation on submit | SPEC §7.6, HLD §4.9 | Reminders fire; submit cancels pending |

### Phase 5 — Conversational Chat
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 5.1 | WebSocket API + chat threads/messages (text + attachments) | SPEC §7.8, HLD §4.14 | < 1s delivery; transcript immutable |
| 5.2 | System event cards (submission, dose change, transfer) | SPEC C-03 | Cards auto-posted with hospital name |
| 5.3 | Read receipts, urgency triage, offline push | SPEC C-05, C-07 | Symptom-concern flags escalate |

### Phase 6 — Care Team & Case Transfer
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 6.1 | Authorization grants (co-managing / consult), revoke, expiry | SPEC §7.9.2 | Access changes reflected next request |
| 6.2 | Case transfer (initiate/accept/decline/admin-force) | SPEC §7.9.3 | Ownership txn atomic; full audit trail |

### Phase 7 — Reporting, Export, Hardening
| WP | Objective | Spec ref | DoD |
|----|-----------|----------|-----|
| 7.1 | PDF export incl. hospital column | SPEC R-01, R-05 | Layout matches paper form |
| 7.2 | Observability, alarms, load/security test pass | HLD §4.12, §6 | Alarms fire in game-day test |

---

## 3. Setting Up the Agents

This project uses a small team of purpose-built agents. Each has a narrow role, a fixed tool set, and a clear hand-off contract. Keeping roles narrow is what makes evaluation and token control tractable.

### 3.1 Agent Roster

| Agent | Role | Reads | Writes | Tools |
|-------|------|-------|--------|-------|
| **Orchestrator** | Breaks a phase into WPs, assigns them, tracks the gate status of each | Spec, HLD, LLD, this plan | Task list only | Planning/todo, dispatch |
| **Context-Gatherer** | Investigates existing code before a change; returns a written map of relevant files/functions | Codebase | Nothing (read-only) | Search, read |
| **Implementer** | Executes one WP: writes code + unit tests to satisfy the DoD | WP spec + gatherer output | Source, tests | Edit, run tests, build |
| **Reviewer / Evaluator** | Judges the implementer's output against the WP acceptance checklist; returns pass/fail + reasons | Diff, WP spec, test results | Review notes | Read, run tests, diff |
| **Infra Agent** | Owns CDK/CloudFormation changes only | `infra/`, HLD | IaC files | Edit, `cdk synth`/`diff` |
| **Doc Agent** | Keeps spec ↔ HLD ↔ LLD ↔ code traceability current | All docs | Docs | Edit |

Rule of thumb: **one WP, one implementer agent, one evaluator agent.** Never let the agent that wrote the code be the sole judge of whether it passed.

### 3.2 Per-Agent Configuration (steering + custom agents)

Create workspace-scoped agent definitions and steering so every agent starts with the same ground truth without re-reading everything each turn.

**a. Steering files** in `.kiro/steering/` (always-included project facts — keep them short):
- `product.md` — one-paragraph product summary + link to `post_op_follow_up_platform_spec_v1.7.md`.
- `structure.md` — the monorepo map (`apps/api`, `apps/web`, `infra`) and where each domain lives.
- `tech.md` — stack + the exact build/test/lint commands agents must use.
- `conventions.md` — coding standards, error-handling standard (LLD §9), test layout, "no PHI in logs" rule.

**b. Custom agents** in `.kiro/agents/` — one definition per role in §3.1. Each definition pins:
- the role prompt (what "done" means for that role),
- the allowed tool set (least privilege — e.g. Reviewer cannot write source),
- which steering/context files auto-load.

**c. Domain context packs** — for each domain (auth, followup, chat, hospital, care-team), a short `*.md` that points to the relevant spec sections, LLD tables, and file paths. The implementer loads only the pack for its WP, not the whole spec.

### 3.3 Agent Operating Loop (per WP)

```
Orchestrator ──picks WP──► Context-Gatherer ──file map──► Implementer
                                                              │
                                            writes code + unit tests
                                                              │
                                                              ▼
                                                   Reviewer / Evaluator
                                                   ├── PASS → merge, close WP
                                                   └── FAIL → return reasons ──► Implementer (retry, capped)
```

- **Retry cap:** 2 automated fix cycles. On a third failure, escalate to a human — this prevents an agent from burning tokens thrashing on a root cause it cannot see.
- **Hand-off contract:** each step emits a compact artifact (file map, diff summary, pass/fail JSON), not a transcript. Downstream agents read the artifact, not the upstream conversation.

### 3.4 Guardrail Hooks (optional but recommended)

Use Kiro hooks to enforce the loop mechanically:
- `PreToolUse` on write tools → block edits outside the WP's declared paths.
- `PostFileSave` on `**/*.ts` → run lint/format so the evaluator never fails on style.
- `PostTaskExec` → run the WP's test subset automatically before marking done.
- `PreToolUse` on any command touching `infra/` prod stacks → require confirmation.

---

## 4. Optimizing Token Usage

Agent development gets expensive when agents re-read large files, carry long transcripts, or re-derive context every turn. These practices keep cost and latency down without sacrificing correctness.

### 4.1 Scope the Context, Not the Repo
- **Load domain packs, not the whole spec.** An implementer working on the hospital picker loads the hospital context pack (spec §7.0, LLD hospital tables, the 3-4 relevant files) — not the 1000-line spec.
- **Prefer signatures over full files.** Use code-outline/AST reads for large files; pull the full body only for the function being changed.
- **Use the context-gatherer as a compressor.** It reads broadly once and returns a short map. Downstream agents consume the map (hundreds of tokens) instead of re-reading the files (tens of thousands).

### 4.2 Keep the Working Set Small
- **One WP per agent session.** Small, well-scoped WPs mean short transcripts and a clean context window.
- **Summarize and reset between WPs.** Persist a compact "what changed + why" note to the task list, then start the next WP fresh rather than carrying the old conversation.
- **Artifacts over transcripts for hand-offs** (see §3.3). A diff summary + pass/fail JSON is far cheaper than replaying a dialogue.

### 4.3 Cache the Stable Stuff
- **Steering files carry durable facts** (structure, commands, conventions) so agents never re-discover them. Keep steering lean — every always-included token is paid on every turn.
- **Reuse gatherer output** within a WP; don't re-investigate the same question with reworded prompts.
- **Pin versions and commands** in `tech.md` so agents don't spend turns probing "which test runner is this."

### 4.4 Right-Size the Model and the Turn
- **Match model to task.** Use a smaller/cheaper model for mechanical work (formatting, boilerplate, test scaffolds) and reserve the strongest model for design-level reasoning and evaluation.
- **Batch independent tool calls.** Reads/searches with no dependency between them go in one turn, not a chain of round-trips.
- **Cap retries** (§3.3). Thrashing is the largest silent token cost; a 2-retry ceiling plus human escalation bounds it.

### 4.5 Write Efficiently
- **Targeted edits over full rewrites.** Use string-replace edits for changes to existing files; only rewrite a file when it's genuinely new or mostly changed. (Full rewrites of large files also risk transport failures — chunk them.)
- **Don't re-read after a successful rename/move.** Trust tool success messages instead of re-verifying by reading the file back.

### 4.6 A Simple Token Budget
| Activity | Guideline |
|----------|-----------|
| Context load per WP | Aim < 15k tokens (domain pack + gatherer map + target file) |
| Implementer turn | Prefer incremental edits; avoid re-pasting unchanged code |
| Evaluator turn | Feed the diff + checklist, not the whole file tree |
| Hand-off artifact | Keep under ~1k tokens (summary, not transcript) |
| Retry ceiling | 2 automated cycles, then escalate |

Track spend per phase; if a phase overruns its budget, the usual cause is oversized WPs or missing steering — fix the process, not the ceiling.

---

## 5. Validating the Application

Validation is layered: fast checks run on every change, heavier checks run at phase gates, and a final acceptance pass maps directly to the spec's acceptance criteria. In agent-based development the evaluation is itself partly automated (evaluator agent) but always backed by executable tests and a human gate for anything safety-sensitive.

### 5.1 The Validation Pyramid

```
                 ┌───────────────────────────┐
                 │  Manual / Human review     │  auth, PHI, transfer, RLS
                 ├───────────────────────────┤
                 │  E2E (Playwright)          │  full user journeys per portal
                 ├───────────────────────────┤
                 │  Integration (API + DB)    │  RLS, presign, notifications
                 ├───────────────────────────┤
                 │  Unit (Vitest/Jest)        │  handlers, validators, utils
                 └───────────────────────────┘
```

### 5.2 Per-WP Evaluation (the gate)
Every WP is evaluated before it is accepted. The evaluator agent checks, in order:
1. **Builds & lints clean** — `npm run build && npm run lint`.
2. **Tests pass** — the WP ships unit tests; they run green and cover the DoD's behavior, not just happy path.
3. **DoD checklist met** — each DoD bullet is demonstrably satisfied (link to the test or output that proves it).
4. **Spec traceability** — the change references its spec ID(s); no scope creep beyond the WP.
5. **Guardrails** — no secrets/PHI in code or logs; edits stay within declared paths.

Output is a short pass/fail record with reasons. A "command exited 0" is **not** acceptance — the evaluator confirms the behavior the WP promised.

### 5.3 Integration Validation (per phase)
Run against an ephemeral environment (throwaway Aurora + LocalStack or a sandbox account):
- **RLS enforcement:** a patient/doctor cannot read another patient's rows; transferred doctor sees only pre-transfer rows; patient never sees the internal consult thread.
- **Hospital rules:** submission rejected without `engagement_hospital_id`; picker returns only the primary doctor's active affiliations + Virtual; deactivating a hospital leaves historical rows intact.
- **Notifications:** no duplicate reminders (dedup id); submit cancels pending reminders; no PHI in SMS/WhatsApp/chat-alert bodies.
- **File handling:** EICAR test file is quarantined; a message with a pending attachment is held until the scan clears.
- **Chat:** message delivered < 1s; transcript is immutable (UPDATE/DELETE denied at DB grant level).

### 5.4 End-to-End Journeys (per portal)
Automate the spec's user flows with Playwright:
- Patient: sign in → pick hospital → submit follow-up → receive doctor response → chat.
- Doctor: review submission → prescribe doses → reply → grant consult access → filter dashboard by hospital.
- Transfer: initiate → target accepts → ownership + audit + chat system card verified.
- Admin: register hospital → add affiliation → deactivate hospital.

### 5.5 Non-Functional Validation
- **Security:** dependency/secret scanning in CI; auth/rate-limit tests; least-privilege IAM review; a scoped pen-test before go-live.
- **Performance:** load test the core write path and the chat WebSocket to the spec targets (chat < 1s, hospital picker search < 300ms).
- **Reliability:** game-day — kill a Lambda/DLQ backup and confirm alarms + recovery.
- **Data residency:** confirm all stateful services and buckets are in ap-south-1.

### 5.6 Acceptance Validation (release gate)
Map each item in **spec §18 Acceptance Criteria (MVP)** to at least one automated test or a signed-off manual check. The release is accepted only when:
- All §18 criteria (1–23, including the v1.7 hospital criteria 17–23) have a passing linked check.
- All phase integration + E2E suites are green.
- Security and performance NFR checks pass.
- A human has reviewed every safety-sensitive area (authentication, RLS/authorization, case transfer, PHI handling).

### 5.7 Continuous Validation
- CI runs unit + lint on every PR; integration on merge to main; E2E nightly against staging.
- A regression suite grows with every bug: each fixed defect adds a test so agents can't silently reintroduce it.
- Traceability report (Doc Agent) flags any spec section without a corresponding test or implementation.

---

## 6. Definition of Done (Whole Application)

The application is done when: every phase milestone is evaluated and green; every spec §18 acceptance criterion has a linked passing check; security, performance, and data-residency NFRs pass; and safety-sensitive areas have human sign-off. Agents implement and self-check; humans own the final gate on anything touching auth, authorization, PHI, and case transfer.
