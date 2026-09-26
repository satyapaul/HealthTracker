# Conventions & Standards

Durable coding standards for all agents and contributors. Keep changes scoped to the work
package; do not refactor unrelated code.

## Security & PHI (non-negotiable)

- **IMPORTANT: No PHI in logs.** Never log patient identifiers, names, lab values, doses,
  message bodies, phone numbers, or emails. Log opaque IDs and event types only.
- **IMPORTANT: No PHI in notification bodies** (SMS/WhatsApp/email/push) — send a deep link, not clinical content.
- **Enforce access at both layers.** API-layer authorization AND PostgreSQL Row-Level Security.
  Every DB query runs with session vars set: `app.current_user_id`, `app.current_role`,
  and (for patient/caregiver) `app.current_patient_id`. Never bypass RLS with a superuser role.
- **Immutable records are immutable.** Chat transcripts, dose-change history, authorization
  grants, and case-transfer logs are append-only — no UPDATE/DELETE paths.
- **Secrets** come from Secrets Manager / SSM Parameter Store — never hardcoded, never committed.
  Flag any `.env`/credential file before committing.
- **PHI residency**: all stateful services and buckets stay in ap-south-1.

## API contract standard (LLD §3)

All responses use the standard envelope:

```json
{ "success": true, "data": {}, "error": null }
```

Errors:

```json
{
  "success": false,
  "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {} }
}
```

Auth via `Authorization: Bearer <sessionToken>` (except public auth callbacks). Validate all
input at the handler boundary; use parameterized SQL only (never string-interpolated queries).

## Error handling (LLD §9)

- Throw typed errors with a stable `code`; map to the error envelope at the handler edge.
- Distinguish client (4xx) from server (5xx) errors; don't leak internals or PHI in messages.
- External calls (OAuth, SMS, WhatsApp, S3) are retried/handled explicitly; surface `503`-style codes on upstream failure.

## Naming

- DB: `snake_case` tables/columns; canonical field keys from spec §7.2.1 (e.g. `bilirubin_total`, `tac_level`).
- TypeScript: `camelCase` values, `PascalCase` types/components; files `kebab-case.ts`.
- Lambda domains: one folder per domain under `apps/api/functions/<domain>/`.
- AWS resources: prefix `PostOpCare-` and suffix the environment (matches existing CDK stacks).

## Testing

- Ship tests with every change; cover the behavior in the WP's definition-of-done, not just the happy path.
- Layers (per guidance §5.1): unit (handlers/validators/utils) → integration (API+DB, RLS, presign) → E2E (Playwright per portal) → human review for safety-sensitive areas.
- Must-test invariants: cross-patient access denied; submission rejected without `engagement_hospital_id`; no duplicate reminders; EICAR file quarantined; chat transcript immutable.
- infra tests live in `infra/test/`; app tests co-locate per workspace (confirm layout in `tech.md` after Phase 0.1).

## Editing discipline (token & safety hygiene)

- Targeted edits over full rewrites; only rewrite genuinely new or mostly-changed files.
- Never edit an already-applied DB migration — add a new one.
- Stay within the work package's declared paths.
- Human sign-off is required for auth, authorization/RLS, case transfer, and PHI handling
  before those changes are accepted.
