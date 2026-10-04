# CX Demo — single-process, no AWS

Run the whole Post-Op Care **customer experience** (patient + doctor portals)
as one Node process serving the built React SPA and a **seeded in-memory API**
from a single origin. No AWS, no database, no credentials — all data is harness
fixtures held in memory and **reset on every restart**. For sharing / review
only, not production.

## What it is (and isn't)

- ✅ Real UI, real Lambda handler logic, real routing, the real
  `{ success, data, error }` envelope, real validation + authorization checks,
  and the real session-token auth flow.
- ✅ Seeded data: one patient (Raghavendra, 3 follow-up rows incl. a reviewed
  one with a doctor response + dose change) and one doctor (Dr. Rajesh Dey).
- ❌ No real SMS (the OTP is a fixed dev code, shown on the login screen).
- ❌ No real OAuth (the Google/X/Facebook buttons are not wired).
- ❌ Not multi-instance; data resets on restart.

## Demo sign-in

No real SMS is sent. On the welcome screen, enter one of:

| Role    | Phone        | OTP code |
| ------- | ------------ | -------- |
| Patient | `9999900001` | `424242` |
| Doctor  | `9999900002` | `424242` |

## Run it

### Option A — Docker (recommended for sharing)

```bash
docker build -f Dockerfile.demo -t postopcare-demo .
docker run --rm -p 8080:8080 postopcare-demo
# open http://localhost:8080
```

> Note: the Node path (Option B) is verified end-to-end. The Docker image build
> has not been run in this environment (no Docker available here); the
> Dockerfile is standard multi-stage and mirrors Option B exactly, but validate
> `docker build` on first use.

### Option B — Node (no Docker)

```bash
npm ci
npm run demo        # builds api + SPA, then serves on PORT (default 8080)
# open http://localhost:8080
```

`npm run demo` = `demo:build` (compiles the api + builds the SPA with
same-origin + demo mode) then `demo:serve` (runs the harness with
`WEB_DIST=apps/web/dist`). Override the port with `PORT=3000 npm run demo`.

## Deploy anywhere that runs Node

The demo is one process on one port, so any Node/container host works
(Render, Railway, Fly.io, App Runner, a plain VM, etc.):

1. Build the image: `docker build -f Dockerfile.demo -t postopcare-demo .`
2. Push it to the host's registry and run it, exposing the container's `PORT`
   (default `8080`). The host's provided `PORT` env is honored.

No environment variables are required. The SPA is built to call the API on the
**same origin**, so it works on whatever hostname/port the container is served
from.

## Notes

- The SPA uses a hash router, so URLs look like `https://<host>/#/welcome`.
- To instead run the SPA against a separate API during development, set
  `apps/web/.env.local` with `VITE_API_BASE_URL=http://localhost:4000` and run
  the Vite dev server (`npm run dev --workspace @postopcare/web`) + the harness
  (`PORT=4000 node apps/api/dist/harness/server.js`) separately.
