# RLS / Authorization Sign-off Summary — Migrations V3–V10

**Status:** Awaiting human sign-off (per `.kiro/steering/conventions.md`: "Human
sign-off is required for auth, authorization/RLS, case transfer, and PHI
handling before those changes are accepted.")

**Scope:** every Row-Level Security (RLS) and authorization decision introduced
across Phases 1–4 (migrations **V3–V10**) plus the matching application-layer
authorization in the Lambda domains. Phases 0–4 are code-complete and committed
(`origin/main`); these security-sensitive pieces have **not** yet been
human-reviewed, and the live-DB RLS integration tests remain deferred.

**How to use this doc:** each section states what the policy does, the exact
predicate, the intent, and any **⚠ review points** worth a careful look. A
reviewer can sign each table/area off (or flag it) in one pass. Line references
point at `db/sql/V*.sql` and `apps/api/functions/*`.

---

## 0. The access model in one paragraph

The app connects to PostgreSQL as a single least-privilege role
(`postopcare_app`, V2) with **no BYPASSRLS**. Before every user-scoped query the
application sets three transaction-local session vars via the shared helper
(`@postopcare/common` `withRlsContext` / `applyRlsContext`, parameterized
`set_config(..., true)`): `app.current_user_id`, `app.current_role`,
`app.current_patient_id`. Every clinical table has `ENABLE` **and** `FORCE ROW
LEVEL SECURITY`, so even the table owner is subject to policy. Policies read the
session vars through three `STABLE` helper functions (V3). Authorization is thus
enforced at **two layers**: the API/service layer (role checks, ownership
checks) and the database (RLS) — a bug in one is backstopped by the other.

**Trust boundary:** RLS correctness depends on the session vars being set from
the authenticated principal (the WP 1.2 authorizer context) and never from
client-supplied values. That wiring is in `@postopcare/common` (reviewed under
WP 1.3) and each domain's `index.ts` principal extraction. **⚠ The single most
important invariant to confirm: no code path sets `app.current_*` from request
body/query input.**

---

## 1. V2 — app role & baseline grants

- Creates `postopcare_app` as `NOLOGIN`, `GRANT SELECT/INSERT/UPDATE/DELETE ON
ALL TABLES` + `ALTER DEFAULT PRIVILEGES` so later tables inherit the grants.
- **Intent:** one least-privilege role for all app DB access; RLS (not grants)
  does the per-row authorization. Table-level grants are broad **by design** —
  the row policies are the real gate.
- **⚠ Review point:** this is the "grants are broad, RLS is the gate" decision.
  If a future table is created without `ENABLE ROW LEVEL SECURITY`, the default
  grant would expose it fully. Mitigation today: every clinical table in V4–V10
  explicitly enables+forces RLS. Worth a standing checklist item for new tables.

## 2. V3 — session-context helpers (no table policies)

- `app_current_user_id()`, `app_current_role()`, `app_current_patient_id()` —
  each `NULLIF(current_setting('app.current_*', true), '')`, `STABLE`,
  `missing_ok => true`.
- **Intent:** centralize the read side so policies are concise and NULL-safe. An
  unset/blank context yields `NULL`, which **matches no row** in every policy
  below (fail-closed). `app_current_role()` is intentionally **not** cast to the
  enum, so a blank/unknown role is simply non-matching rather than an error.
- **⚠ Review point:** confirm the fail-closed reasoning — e.g. for a patient
  policy `id = app_current_patient_id()`, if the context is unset the predicate
  is `id = NULL` → no rows. Good. Verify no policy uses a negated form that
  would flip open on NULL.

---

## 3. Per-table RLS policies

Notation: **P/C** = patient/caregiver, **D** = doctor, **A** = admin. All
predicates use the V3 helpers.

### 3.1 patients (V4 §2.1 + V6 retrofit)

| Policy                    | Cmd    | Predicate                                                                                                           | Notes                                                                  |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `patients_patient_select` | SELECT | role∈(patient,caregiver) AND `id = app_current_patient_id()`                                                        | own chart only                                                         |
| `patients_patient_update` | UPDATE | same, USING + WITH CHECK                                                                                            | can't re-point row to another patient                                  |
| `patients_admin_all`      | ALL    | role=admin                                                                                                          | onboarding + management                                                |
| `patients_doctor_select`  | SELECT | role=doctor AND `id IN (SELECT patient_id FROM doctor_patient_assignments WHERE doctor_id = app_current_user_id())` | **added in V6** (deferred from V4 until the assignments table existed) |

- No DELETE policy → patients are never hard-deleted via the app role.
- **⚠ Review points:** (a) a doctor's read is gated purely by
  `doctor_patient_assignments` (the v1.7 care-team predicate of
  primary_doctor + active authorizations is **deferred to Phase 6** — see §4);
  (b) there is no patient INSERT policy — only admin creates charts, matching
  the service-layer "admin only" guard.

### 3.2 follow_up_rows (V5 §2.2 + V6 retrofit)

| Policy               | Cmd    | Predicate                                       | Notes                                                                |
| -------------------- | ------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| `fur_patient_select` | SELECT | P/C AND `patient_id = app_current_patient_id()` | own rows                                                             |
| `fur_patient_insert` | INSERT | P/C AND `patient_id = app_current_patient_id()` | can only create own rows                                             |
| `fur_patient_update` | UPDATE | P/C AND own AND **`status = 'draft'`**          | a submitted row is immutable to the patient                          |
| `fur_admin_all`      | ALL    | role=admin                                      |                                                                      |
| `fur_doctor_select`  | SELECT | role=doctor AND assigned (via dpa)              | **V6 retrofit**                                                      |
| `fur_doctor_update`  | UPDATE | role=doctor AND assigned (via dpa)              | **V6 retrofit** — scopes which rows a doctor may touch during review |

- **⚠ Review points:** (a) the draft-only patient UPDATE is a key immutability
  control — confirm the WITH CHECK keeps the row bound to the same patient;
  (b) `fur_doctor_update` is broad (any assigned row) — the pending→reviewed
  status transition and field whitelist are enforced in the **service**
  (dose domain), not RLS. Confirm that service guard is sufficient, or decide
  whether the row-status restriction belongs in RLS too.

### 3.3 doctor_patient_assignments (V6 §2.9)

| Policy              | Cmd    | Predicate                                           |
| ------------------- | ------ | --------------------------------------------------- |
| `dpa_doctor_select` | SELECT | role=doctor AND `doctor_id = app_current_user_id()` |
| `dpa_admin_all`     | ALL    | role=admin                                          |

- **This table is the lynchpin:** it's the predicate behind every doctor policy
  on patients/follow_up_rows/attachments/dose_changes/doctor_responses/
  milestones/reminder_schedules. **⚠ Highest-value review target.** It was
  brought forward from Phase 6 (Option A, approved) specifically so doctor
  access is real and non-throwaway. Who writes rows into it? Today: **nobody in
  app code yet** — there is no endpoint that inserts assignments (patient
  onboarding with `assignedDoctorId` is a later WP). So in the current build a
  doctor sees **no** patient data until that onboarding path exists. Confirm
  that's the intended interim posture.

### 3.4 dose_changes (V6 §2.4) — append-only audit

| Policy              | Cmd    | Predicate                               |
| ------------------- | ------ | --------------------------------------- |
| `dc_patient_select` | SELECT | P/C AND row's follow_up belongs to them |
| `dc_doctor_select`  | SELECT | doctor AND assigned (dpa join)          |
| `dc_doctor_insert`  | INSERT | doctor AND assigned (dpa join)          |
| `dc_admin_all`      | ALL    | role=admin                              |

- **Immutability:** the app role is granted **SELECT + INSERT only** (no
  UPDATE/DELETE) — enforced at the grant level, not just by convention.
- **⚠ Review point:** confirm append-only is acceptable for the audit trail and
  that no code expects to update a dose_change.

### 3.5 doctor_responses (V6 §2.5) — append-only, one per row

| Policy              | Cmd    | Predicate                                                       |
| ------------------- | ------ | --------------------------------------------------------------- |
| `dr_patient_select` | SELECT | P/C AND own row                                                 |
| `dr_doctor_select`  | SELECT | doctor AND assigned                                             |
| `dr_doctor_insert`  | INSERT | doctor AND assigned AND **`doctor_id = app_current_user_id()`** |
| `dr_admin_all`      | ALL    | role=admin                                                      |

- SELECT+INSERT grant only; `UNIQUE(follow_up_row_id)` enforces one response.
- **⚠ Review point:** the insert policy additionally pins `doctor_id` to the
  acting user (a doctor can't attribute a response to someone else). Good —
  confirm.

### 3.6 attachments (V7 §2.3)

| Policy               | Cmd    | Predicate           |
| -------------------- | ------ | ------------------- |
| `att_patient_select` | SELECT | P/C AND own row     |
| `att_patient_insert` | INSERT | P/C AND own row     |
| `att_doctor_select`  | SELECT | doctor AND assigned |
| `att_admin_all`      | ALL    | role=admin          |

- **⚠ Review point:** the virus-scan Lambda flips `scan_status` **outside** the
  app role, under a scoped service path (a separate `ScannerDbPort`, keyed by
  object_key, no RLS context) — per LLD §2.3. That scoped role's grant is infra,
  not in these migrations. Confirm the scanner is the only writer of
  `scan_status` and that it never runs as `postopcare_app`.

### 3.7 hospitals (V8 §2.10) — non-PHI reference data

| Policy                   | Cmd    | Predicate                                   |
| ------------------------ | ------ | ------------------------------------------- |
| `hospitals_read_all`     | SELECT | **`USING (true)`** — any authenticated role |
| `hospitals_admin_insert` | INSERT | role=admin                                  |
| `hospitals_admin_update` | UPDATE | role=admin AND `id <> VIRTUAL_UUID`         |
| (no DELETE policy)       | —      | DELETE denied for all → non-deletable       |

- **⚠ Review points:** (a) `read_all = USING(true)` is intentional (hospitals
  are non-PHI reference data needed to render pickers/headers) — confirm that
  classification; (b) the Virtual Hospital (`00000000-…-0000`) is non-editable
  (excluded from admin update) and non-deletable (no DELETE policy) at the data
  layer, plus an app-layer guard. Two independent controls — confirm both.

### 3.8 hospital_doctor_affiliations (V8 §2.11)

| Policy              | Cmd    | Predicate                                                      |
| ------------------- | ------ | -------------------------------------------------------------- |
| `hda_doctor_select` | SELECT | role=doctor AND `doctor_id = app_current_user_id()` (own only) |
| `hda_admin_all`     | ALL    | role=admin                                                     |

- **⚠ Review point:** a doctor can read only their own affiliations; only admin
  manages them. The one-primary-per-doctor rule is a DB partial-unique index +
  a service check. Confirm doctors shouldn't self-serve affiliations (H-06
  request/approve is deferred).

### 3.9 notifications (V9 §2.6)

| Policy                       | Cmd    | Predicate                                  |
| ---------------------------- | ------ | ------------------------------------------ |
| `notifications_owner_select` | SELECT | `user_id = app_current_user_id()` OR admin |
| `notifications_owner_update` | UPDATE | same (mark read)                           |
| `notifications_insert`       | INSERT | **`WITH CHECK (true)`**                    |
| (no DELETE policy)           | —      | denied                                     |

- **⚠⚠ Highest-scrutiny policy in this batch.** `notifications_insert` with
  `WITH CHECK (true)` lets the app role insert a notification row for **any**
  `user_id`. **Rationale:** the dispatcher is trusted server code that
  legitimately writes in-app rows for other users (the people being notified),
  and it does not run as a patient/doctor principal fabricating rows. **But**
  because the whole app shares one DB role, this policy technically permits a
  _compromised or buggy_ request handler running under any role to insert a
  notification for an arbitrary user. The read side is strictly owner-scoped, so
  the blast radius is "spoofed in-app notification," not data disclosure.
  **Decision needed:** accept as-is (trusting the dispatcher is the only
  inserter), OR tighten — e.g. only allow insert when `app_current_role()` is a
  server/system context, or move notification inserts to a scoped service role
  like the virus scanner. I recommend an explicit decision here rather than a
  silent accept.

### 3.10 milestones (V10 §2.6) & reminder_schedules (V10 §2.7)

| Table              | Policy              | Cmd    | Predicate                               |
| ------------------ | ------------------- | ------ | --------------------------------------- |
| milestones         | `ms_patient_select` | SELECT | P/C AND own                             |
|                    | `ms_doctor_select`  | SELECT | doctor AND assigned                     |
|                    | `ms_doctor_insert`  | INSERT | doctor AND assigned                     |
|                    | `ms_doctor_update`  | UPDATE | doctor AND assigned                     |
|                    | `ms_admin_all`      | ALL    | admin                                   |
| reminder_schedules | `rs_patient_select` | SELECT | P/C AND milestone is theirs             |
|                    | `rs_doctor_all`     | ALL    | doctor AND milestone's patient assigned |
|                    | `rs_admin_all`      | ALL    | admin                                   |

- **⚠ Review point:** the milestone-evaluator (scheduled batch) flips reminders
  `pending→sent` and inserts overdue reminders under an **admin/service
  context** (`setSessionContext({ role: 'admin' })` in the evaluator), not a
  user principal. Same pattern question as the scanner/dispatcher: is "evaluator
  runs as admin context" acceptable, or should it be a distinct service role?
  Consistency decision across scanner + dispatcher + evaluator.

---

## 4. Deliberately deferred (not yet enforced) — confirm these are understood

These were approved deferrals during the build; they mean certain access is
**fail-closed (denied) today** and lands later:

1. **v1.7 care-team predicate (Phase 6).** Doctor access everywhere currently =
   `doctor_patient_assignments` only. The richer model (primary_doctor_id OR
   active `doctor_authorizations`, plus transferred-doctor time-bounded
   read-only) is Phase 6. Until then, co-managing/consulting/transferred-doctor
   access does not exist.
2. **Hospital FK constraints** were deferred V4/V5 → wired in V8 (now done).
3. **Live-DB RLS integration tests (all phases).** Every policy above is unit-
   tested against in-memory fakes that _mirror_ the RLS logic, but **none has
   executed against PostgreSQL**. The must-test invariants from conventions
   (cross-patient denied, etc.) are proven at the service layer, not yet at the
   DB layer. This is the biggest verification gap.

---

## 5. Application-layer authorization (the second gate)

RLS is backstopped by explicit role/ownership checks in the services. Key ones:

- **patient:** create = admin only; read/update = own chart (RLS) + doctor
  denied for update in this phase.
- **followup:** patient/caregiver only; `engagement_hospital_id` required and
  validated (Virtual or an active affiliation of the patient's primary doctor);
  draft-only edit; one row per (patient, pp_date).
- **dose (review):** doctor only; row must be `pending`; one response per row;
  unassigned doctor → 404 (no existence leak).
- **admin:** every route requires `role=admin`; Virtual-Hospital guards;
  immutable `id`/`hospital_code`; affiliation target must be a `doctor`.
- **hospital (picker):** `forPatient` access check (patient→own, doctor→assigned,
  admin→any); H-05 doctor-only.
- **milestone:** create = assigned doctor, future date only.

**⚠ Review point:** these service checks and the RLS policies must agree. Where
they differ by design (e.g. `fur_doctor_update` is broad in RLS but the dose
service only allows a pending→reviewed transition), confirm the stricter layer
is doing the real work and the looser layer is an acceptable backstop.

---

## 6. Cross-cutting observations for the reviewer

1. **No PHI in logs or notification bodies** — enforced by convention + PHI-free
   logger usage across domains and PHI-free notification/in-app payloads. Spot-
   check a few `logger.*` calls.
2. **Parameterized SQL only** — the session-context helper binds values as
   parameters; no string interpolation. Confirm the real DB adapters (deferred
   to infra) keep this when they land.
3. **One shared DB role** is the structural reason several policies lean on
   "trusted server code" (notifications insert, scanner, evaluator). A reviewer
   may want a policy on whether high-privilege server paths (dispatcher,
   evaluator, scanner) should use **distinct scoped DB roles** rather than
   `postopcare_app` + an admin session context. This is the one recurring
   architectural question across §3.6, §3.9, §3.10.

---

## 7. Suggested sign-off checklist

- [ ] §0 trust boundary: session vars never set from client input
- [ ] §2 V3 helpers fail-closed on NULL
- [ ] §3.1 patients policies
- [ ] §3.2 follow_up_rows policies (draft-only immutability; doctor-update breadth)
- [ ] §3.3 doctor_patient_assignments (lynchpin; interim "no assignments writer")
- [ ] §3.4 / §3.5 dose_changes / doctor_responses append-only
- [ ] §3.6 attachments + scanner scoped-write boundary
- [ ] §3.7 hospitals read_all=true + Virtual immutability
- [ ] §3.8 affiliations doctor-reads-own
- [ ] **§3.9 notifications `WITH CHECK (true)` insert — explicit accept or tighten**
- [ ] §3.10 milestones/reminders + evaluator admin-context
- [ ] §4 deferrals understood (esp. Phase 6 care-team; live-DB tests gap)
- [ ] §6.3 decision: scoped service roles vs shared role + admin context
