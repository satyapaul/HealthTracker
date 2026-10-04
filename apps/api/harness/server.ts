/**
 * Local HTTP harness (Option 3) — stands the REAL Lambda handlers up over a
 * plain node:http server, backed by the in-memory test fakes. It exercises the
 * genuine handler + routing + envelope + validation + authorization code over
 * HTTP, with NO AWS and NO real database.
 *
 * Scope + honesty:
 *   - This is a developer smoke harness, not production. Each domain gets its
 *     own fake bundle, pre-seeded with a consistent fixture set (same ids for
 *     admin / doctor / patient / hospital across domains) so each endpoint
 *     behaves correctly. State created in one domain does NOT propagate to
 *     another (separate in-memory stores) — the suite seeds what each endpoint
 *     needs. A real deployment shares one Postgres; here we trade that for
 *     zero-dependency local execution.
 *   - Auth is a DEV SHIM: `Authorization: Bearer dev:<userId>:<role>:<patientId>`
 *     is parsed into the WP 1.2 authorizer context. This stands in for the real
 *     JWT/session authorizer so the smoke tests can act as any principal.
 *
 * Run: build the api workspace (tsc) then
 *   node apps/api/dist/harness/server.js            (PORT env, default 4000)
 */
import http from 'node:http';

// Real handler entry adapters (handlerWithDeps) + their test fakes.
import { handlerWithDeps as patientHandler } from '../functions/patient';
import { makeBundle as patientBundle } from '../functions/patient/__tests__/fakes';
import { handlerWithDeps as followupHandler } from '../functions/followup';
import { makeBundle as followupBundle } from '../functions/followup/__tests__/fakes';
import { handlerWithDeps as doseHandler } from '../functions/dose';
import { makeBundle as doseBundle } from '../functions/dose/__tests__/fakes';
import { handlerWithDeps as hospitalHandler } from '../functions/hospital';
import { makeBundle as hospitalBundle } from '../functions/hospital/__tests__/fakes';
import { handlerWithDeps as adminHandler } from '../functions/admin';
import { makeBundle as adminBundle } from '../functions/admin/__tests__/fakes';
import { handlerWithDeps as chatHandler } from '../functions/chat';
import { makeBundle as chatBundle } from '../functions/chat/__tests__/fakes';

import { seedAll, type Fixture } from './seed';

interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}
type LambdaFn = (event: ApiEvent) => Promise<LambdaResult>;

interface ApiEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  pathParameters: Record<string, string | undefined>;
  queryStringParameters: Record<string, string | undefined>;
  requestContext: { authorizer: { lambda: Record<string, string> } };
}

/** Parse the dev auth token into an authorizer context, if present. */
function devPrincipal(headers: http.IncomingHttpHeaders): Record<string, string> {
  const raw = headers['authorization'];
  if (typeof raw !== 'string') return {};
  const m = /^Bearer\s+dev:([^:]*):([^:]*):(.*)$/.exec(raw.trim());
  if (!m) return {};
  return { userId: m[1], role: m[2], patientId: m[3] ?? '' };
}

/** API Gateway path params are resolved by the proxy; here the domain routers
 *  re-parse the path themselves, so we only need to pass the raw path. The
 *  patient/followup/etc. routers read pathParameters only for the proxy `{id}`
 *  style — but our domains parse from `path`, so an empty map is fine. */
function toEvent(
  req: http.IncomingMessage,
  pathname: string,
  query: URLSearchParams,
  body: string
): ApiEvent {
  const q: Record<string, string> = {};
  query.forEach((v, k) => (q[k] = v));
  return {
    httpMethod: req.method ?? 'GET',
    path: pathname,
    headers: { authorization: req.headers['authorization'] as string | undefined },
    body: body.length > 0 ? body : null,
    pathParameters: {},
    queryStringParameters: q,
    requestContext: { authorizer: { lambda: devPrincipal(req.headers) } },
  };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Build the per-domain handlers over seeded fake bundles. */
function buildRoutes(fx: Fixture): { match: (p: string) => LambdaFn | null } {
  const patient = patientHandler(fx.patient.deps) as unknown as LambdaFn;
  const followup = followupHandler(fx.followup.deps) as unknown as LambdaFn;
  const dose = doseHandler(fx.dose.deps) as unknown as LambdaFn;
  const hospital = hospitalHandler(fx.hospital.deps) as unknown as LambdaFn;
  const admin = adminHandler(fx.admin.deps) as unknown as LambdaFn;
  const chat = chatHandler(fx.chat.deps) as unknown as LambdaFn;

  return {
    match(pathname: string): LambdaFn | null {
      if (pathname.startsWith('/admin/')) return admin;
      if (pathname === '/patients' || pathname.startsWith('/patients/')) return patient;
      if (pathname.startsWith('/followup/'))
        return followup === dose ? followup : routeFollowupOrDose(pathname, followup, dose);
      if (
        pathname === '/hospitals' ||
        pathname.startsWith('/hospitals/') ||
        pathname === '/doctors/me/affiliations'
      )
        return hospital;
      if (pathname.startsWith('/chat/')) return chat;
      return null;
    },
  };
}

/** /followup/rows/{id}/response + /dose-changes belong to the dose domain;
 *  everything else under /followup to the followup domain. */
function routeFollowupOrDose(pathname: string, followup: LambdaFn, dose: LambdaFn): LambdaFn {
  if (/\/response$/.test(pathname) || /\/dose-changes$/.test(pathname)) return dose;
  return followup;
}

export function startServer(port: number): http.Server {
  const fx = seedAll({
    patient: patientBundle(),
    followup: followupBundle(),
    dose: doseBundle(),
    hospital: hospitalBundle(),
    admin: adminBundle(),
    chat: chatBundle(),
  });
  const routes = buildRoutes(fx);

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);
        const body = await readBody(req);
        const handler = routes.match(url.pathname);
        if (!handler) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              data: null,
              error: { code: 'NOT_FOUND', message: 'No route' },
            })
          );
          return;
        }
        const result = await handler(toEvent(req, url.pathname, url.searchParams, body));
        res.writeHead(result.statusCode, result.headers ?? { 'content-type': 'application/json' });
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'HARNESS_ERROR', message: (err as Error).message },
          })
        );
      }
    })();
  });
  server.listen(port, () => {
    console.log(`[harness] listening on http://localhost:${port}`);
  });
  return server;
}

const PORT = Number(process.env.PORT ?? 4000);
startServer(PORT);
