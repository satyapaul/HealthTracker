# Local API smoke harness (dev tooling)

A zero-dependency way to exercise the **real** Lambda handlers over HTTP, with
**no AWS and no database**. It stands each domain's handler up on a plain
`node:http` server backed by the in-memory test fakes, then a set of `curl`
smoke scripts hit it and assert status codes + envelopes.

This is developer tooling, not production. It proves the handler + routing +
request validation + the `{ success, data, error }` envelope + the
authorization rules (role gating, cross-patient denial, chat RLS visibility).
It does **not** exercise the real DB/Redis/S3/SQS adapters (the fakes stand in),
nor the WebSocket chat actions (send / markRead / typing) — only the HTTP reads.

## Layout

```
harness/
  server.ts            node:http server; builds each domain handler over a
                       seeded fake bundle and routes by path.
  seed.ts              shared fixtures — consistent ids across domains:
                         admin-1 / doctor-1 / patient-1 (user-patient-1) / hosp-1
  scripts/
    _lib.sh            BASE_URL + dev tokens + the check()/summary() helpers
    smoke-*.sh         per-domain suites (hospital, patient, followup, dose,
                       admin, chat)
    run-all.sh         build -> start harness -> run every suite -> stop harness
```

## Run it

From the repo root (or `apps/api`):

```bash
# build + start + run the whole suite on a port (default 4000)
PORT=4077 bash apps/api/harness/scripts/run-all.sh

# already built? skip the tsc step
SKIP_BUILD=1 PORT=4077 bash apps/api/harness/scripts/run-all.sh
```

Or run the harness by itself and hit it manually:

```bash
npm run build --workspace @postopcare/api
PORT=4077 node apps/api/dist/harness/server.js
curl -s http://localhost:4077/hospitals?scope=affiliated \
  -H 'Authorization: Bearer dev:doctor-1:doctor:' | jq .
```

## Dev auth shim

The harness accepts a fake bearer token in the form:

```
Authorization: Bearer dev:<userId>:<role>:<patientId>
```

parsed into the WP 1.2 authorizer context
(`requestContext.authorizer.lambda.{userId,role,patientId}`). The scripts
pre-define `TOK_ADMIN` / `TOK_DOCTOR` / `TOK_PATIENT` / `TOK_OTHER_PATIENT` in
`_lib.sh`. This shim ONLY works against the harness.

## Pointing the same scripts at a real deployment

The suites are `BASE_URL`-parameterized, so they can run against a deployed API
unchanged — skip `run-all.sh`, export `BASE_URL`, and swap the dev tokens for
real session tokens:

```bash
export BASE_URL=https://<api-id>.execute-api.ap-south-1.amazonaws.com
# edit _lib.sh TOK_* to real `Authorization: Bearer <sessionToken>` values
./smoke-hospital.sh   # ...etc
```
