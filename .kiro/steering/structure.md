# Project Structure

Target layout is a monorepo. Only `infra/` and `docs/` exist today; `apps/` is planned
(see `docs/development-guidance.md` Phase 0). Create new code in the locations below.

## Top level

```
apps/
  web/                      React SPA — patient, doctor, admin portals (planned)
  api/
    functions/              One folder per Lambda domain (planned)
      auth/  patient/  followup/  dose/  milestone/
      notification/  chat/  care-team/  transfers/
      hospital/  admin/  export/  websocket/  virus-scan/
    layers/common/nodejs/   Shared Lambda layer: db client, auth middleware, utils (planned)
infra/                      AWS CDK (TypeScript) — EXISTS
docs/                       Spec, HLD, LLD, development guidance — EXISTS
CX-mocks/                   PNG UI mockups — EXISTS
.kiro/                      Steering, agents, hooks
```

## infra/ (current)

```
infra/
  bin/app.ts                CDK app entry; wires 8 stacks in dependency order
  lib/
    stacks/                 networking, database, redis, storage, messaging,
                            compute, dataops, edge  (+ legacy dataops-stack.ts)
    constructs/             notification-queue.ts, postopcare-lambda.ts
    types.ts                Shared stack prop/config types
  cfn-01..07 *.yaml         Hand-written CloudFormation references
  cdk.json  package.json  tsconfig.json
```

Stack deploy order: Networking → (Database, Redis, Storage, Messaging) → Compute → DataOps → Edge.
Edge deploys to **us-east-1** (CloudFront + WAF requirement); everything else in **ap-south-1**.

## Where things live (when building)

- New API endpoint → a domain folder under `apps/api/functions/<domain>/`.
- Shared helper used by 2+ functions → `apps/api/layers/common/nodejs/`.
- New AWS resource → a stack under `infra/lib/stacks/` (or a reusable construct in `infra/lib/constructs/`).
- DB schema change → a new Flyway migration (harness planned in Phase 0.4); never edit an applied migration.
- UI screen → `apps/web/`; match the corresponding mock in `CX-mocks/`.

## Data model note

The LLD (`docs/LLD-Technical-Design.md`) is still at v1.3/HLD-v1.0 baseline. The v1.7 tables
(`hospitals`, `hospital_doctor_affiliations`, `doctor_authorizations`, `case_transfer_log`,
`chat_*`, and `engagement_hospital_id` on `follow_up_rows`) are described in the HLD but not yet
in the LLD DDL. Confirm the authoritative schema before implementing those domains.
