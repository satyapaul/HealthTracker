# PostOpCare — Database Migrations

Schema migrations for PostgreSQL 16 (Aurora Serverless v2) using [Flyway](https://documentation.red-gate.com/flyway).

## Layout

```
db/
  flyway.conf              Flyway config (credentials from env vars — never committed)
  sql/
    V1__baseline_auth_schema.sql    Extensions, auth enums, users/auth tables
    V2__app_role_and_grants.sql     postopcare_app role + default privileges
    ...                             Future versioned migrations (V3, V4, ...)
  scripts/
    check-migrations.mjs    Offline naming/ordering checks (runs in CI without a DB)
```

## Credentials

Flyway reads three environment variables — **never hardcode these**:

```sh
export FLYWAY_URL="jdbc:postgresql://<rds-proxy-endpoint>:5432/postopcare"
export FLYWAY_USER="postopcare_master"
export FLYWAY_PASSWORD="from-secrets-manager"
```

In real environments (dev/staging/prod), these are provided by Secrets Manager via
the CI/CD pipeline (CodeBuild) — see HLD §4.13. For local development, point at a
throwaway PostgreSQL 16 instance and set them in a `.env` file (git-ignored).

## Commands

Run from `db/` or via the root workspace:

| Command            | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `npm test`         | Offline migration name/order checks (no DB needed)                          |
| `npm run migrate`  | Apply pending migrations (`flyway migrate`)                                 |
| `npm run info`     | Show applied/pending migration state (`flyway info`)                        |
| `npm run validate` | Verify applied migrations match local files (`flyway validate`)             |
| `npm run repair`   | Fix Flyway schema history after a failed migration (`flyway repair`)        |
| `npm run clean`    | **Destructive** — drop all objects. Only for throwaway DBs (`flyway clean`) |

`migrate`, `info`, `validate`, `repair`, `clean` all require a running PostgreSQL
and the env vars above. `npm test` runs without a database.

## RLS session-variable convention

Every DB query the application executes is preceded by three `SET LOCAL` calls
(see `conventions.md` and LLD §2):

```sql
SET LOCAL app.current_user_id    = '<uuid>';
SET LOCAL app.current_role       = 'patient';   -- or caregiver/doctor/admin
SET LOCAL app.current_patient_id = '<uuid>';     -- set only for patient/caregiver
```

All PHI tables use PostgreSQL Row-Level Security. Policies reference these
variables via `current_setting('app.current_<var>')::UUID` and are added in the
same migration that creates each clinical table (e.g. patients, follow_up_rows).

The application connects as the `postopcare_app` role (created in V2), which has
no direct SELECT/INSERT/UPDATE/DELETE outside of RLS policies on PHI tables.

## Migration rules

Per `conventions.md`:

- **Never edit an already-applied migration.** Add a new versioned migration.
- Use `V<n>__descriptive_name.sql` naming (Flyway convention).
- Versioned numbers must be sequential and gap-free starting at 1.
- Repeatable migrations (if needed) use `R__descriptive_name.sql`.
