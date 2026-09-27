# Tech Stack & Commands

Source of truth for the stack and the exact commands agents must use. Pin versions here so
agents never probe "which runner is this." Based on HLD v2.0 (`docs/HLD-AWS-Architecture.md`)
and LLD v1.0 (`docs/LLD-Technical-Design.md`).

## Stack

| Layer         | Choice                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | React SPA (`apps/web`) — patient, doctor, admin portals                                                                                                             |
| API           | Node.js 22 on AWS Lambda (`apps/api/functions`), one domain per folder                                                                                              |
| Shared code   | Lambda layer at `apps/api/layers/common/nodejs`                                                                                                                     |
| Database      | PostgreSQL 16 on Aurora Serverless v2, accessed via RDS Proxy; Row-Level Security enforced                                                                          |
| Cache/session | Redis (ElastiCache) — sessions, OTP, rate limits, WS connections, hospital cache                                                                                    |
| Storage       | S3 — lab reports, chat media/voice notes, exports, hospital logos (all SSE-KMS)                                                                                     |
| Messaging     | SQS FIFO (per-channel) + SNS + EventBridge Scheduler                                                                                                                |
| Real-time     | API Gateway WebSocket API (chat + in-app notifications)                                                                                                             |
| Audit         | DynamoDB (auth events, delivery receipts) + relational logs in Aurora                                                                                               |
| IaC           | AWS CDK (TypeScript) in `infra/`                                                                                                                                    |
| Migrations    | Flyway (run in CI pre-deploy); lives in the `db/` workspace (`db/sql/V*.sql`, config `db/flyway.conf`, creds from env `FLYWAY_URL`/`FLYWAY_USER`/`FLYWAY_PASSWORD`) |
| Region        | ap-south-1 (Mumbai) for all PHI; Edge (CloudFront + WAF) in us-east-1                                                                                               |

## Commands — monorepo root (Phase 0.1, npm workspaces)

The repo is an npm-workspaces monorepo: members are `apps/*` and `infra`. Run from the repo root:

- Install everything: `npm install` (or `npm ci` in CI) — links all workspaces.
- Lint all: `npm run lint` (ESLint flat config, `eslint.config.mjs`) — `npm run lint:fix` to autofix.
- Format: `npm run format` (Prettier) / `npm run format:check`.
- Test all: `npm test` → runs each workspace's `test` (`--if-present`).
- Build all: `npm run build` → each workspace's `build` (`--if-present`).
- Infra synth from root: `npm run synth`.
  Pre-commit runs `lint-staged` (eslint --fix + prettier) via husky (`.husky/pre-commit`).

## Commands — apps/ workspaces (`@postopcare/web`, `@postopcare/api`)

Per workspace (run from the app dir, or `npm run <script> --workspace @postopcare/<web|api>`):

- Test: `npm test` → `vitest run`.
- Build (typecheck/emit): `npm run build` → `tsc` (extends root `tsconfig.base.json`).
- Lint: `npm run lint` → `eslint .`.
  These are currently placeholder scaffolds (a trivial passing test each) — real code fills them in later phases.

## Commands — infra/ (CDK, also a workspace member)

Run from `infra/` (or via the root as above):

- Build (typecheck): `npm run build`
- Unit tests: `npm test` → `jest --passWithNoTests` (real tests go under `infra/test/`)
- Synth (primary infra gate): `npm run synth` → `cdk synth`
- Diff: `npm run diff`
- Deploy one stack: `npm run deploy:<networking|database|redis|storage|messaging|compute|dataops|edge>`
- Deploy all: `npm run deploy:all`

> **Synth status (as of WP 0.3):** infra `cdk synth` is clean — all 9 stacks synthesize, and
> `npm run synth` and `npm run build --workspace infra` both exit 0. CI runs infra build + synth
> as required gates.

## Commands — db/ workspace (`@postopcare/db`)

Migrations live here (`db/sql/V*.sql`, Flyway config `db/flyway.conf`). Credentials are env-var
driven — never hardcoded. Run from `db/` (or via the root as above):

- Test (offline): `npm test` → migration naming/order check, **no DB needed**. Wired into the root `npm test`.

DB-requiring commands (need a running PostgreSQL 16 + the env vars `FLYWAY_URL` / `FLYWAY_USER` / `FLYWAY_PASSWORD`):

- `npm run migrate` — apply pending migrations (flyway migrate).
- `npm run info` — show applied/pending state (flyway info).
- `npm run validate` — validate applied migrations against the sources (flyway validate).
- `npm run repair` — repair the schema history table (flyway repair).
- `npm run clean` — **destructive**: drops all objects in the target schema. Throwaway/dev DBs only.

## Runtime / versions (pinned)

- Node.js **22** (Lambda + tooling); local dev may run newer (engines warns, non-blocking).
- TypeScript **5.5.x**
- ESLint **9.x** (flat config) + typescript-eslint **8.x**; Prettier **3.x**
- Test runners: **Vitest 2.x** (apps), **Jest 29.x** (infra)
- aws-cdk / aws-cdk-lib **2.155.0**, constructs **10.3.0**
- PostgreSQL **16** (Aurora Serverless v2)
- Migrations: **Flyway** is the migration tool; **PostgreSQL 16** is the target. Migrations are authored to run against Aurora PostgreSQL 16 via the RDS Proxy in real envs.

## Verification expectation

"Command exited 0" is not acceptance. For infra changes, `npm run synth` must be clean.
For app code, run the workspace's build + tests and confirm the behavior the change promised.
