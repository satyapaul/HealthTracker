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
import fs from 'node:fs';
import path from 'node:path';

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
import { handlerWithDeps as authHandler } from '../functions/auth';

import {
  seedAll,
  makeAuthFixture,
  AUTH_PHONES,
  DEV_OTP,
  type AuthFixture,
  type Fixture,
} from './seed';

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

/** Extract the raw bearer token from the Authorization header, or null. */
function bearerToken(headers: http.IncomingHttpHeaders): string | null {
  const raw = headers['authorization'];
  if (typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Resolve the request principal for the WP 1.2 authorizer context. Two paths:
 *   1. A dev token `dev:<userId>:<role>:<patientId>` is parsed directly (the
 *      original smoke-test shim — lets a script act as any principal).
 *   2. Any other bearer token is treated as a REAL opaque session token issued
 *      by the auth handler and resolved against the SAME auth-fake Redis the
 *      authorizer would read (`session:{token}` -> { userId, role, patientId }).
 *      This is what makes a real OTP login authorize subsequent requests.
 * Returns {} (unauthenticated) when neither resolves.
 */
async function resolvePrincipal(
  headers: http.IncomingHttpHeaders,
  authFx: AuthFixture
): Promise<Record<string, string>> {
  const token = bearerToken(headers);
  if (!token) return {};

  const dev = /^dev:([^:]*):([^:]*):(.*)$/.exec(token);
  if (dev) {
    return { userId: dev[1], role: dev[2], patientId: dev[3] ?? '' };
  }

  // Real session token -> look up the shared auth-fake Redis session store.
  const raw = await authFx.redis.get(`session:${token}`);
  if (!raw) return {};
  const payload = JSON.parse(raw) as { userId: string; role: string; patientId: string | null };
  return { userId: payload.userId, role: payload.role, patientId: payload.patientId ?? '' };
}

/** API Gateway path params are resolved by the proxy; here the domain routers
 *  re-parse the path themselves, so we only need to pass the raw path. The
 *  patient/followup/etc. routers read pathParameters only for the proxy `{id}`
 *  style — but our domains parse from `path`, so an empty map is fine. */
async function toEvent(
  req: http.IncomingMessage,
  pathname: string,
  query: URLSearchParams,
  body: string,
  authFx: AuthFixture
): Promise<ApiEvent> {
  const q: Record<string, string> = {};
  query.forEach((v, k) => (q[k] = v));
  return {
    httpMethod: req.method ?? 'GET',
    path: pathname,
    headers: { authorization: req.headers['authorization'] as string | undefined },
    body: body.length > 0 ? body : null,
    pathParameters: {},
    queryStringParameters: q,
    requestContext: { authorizer: { lambda: await resolvePrincipal(req.headers, authFx) } },
  };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serve the built SPA from WEB_DIST (single-process demo deploy). Non-API
 * requests resolve to a file under the dist dir; unknown non-asset paths fall
 * back to index.html so the client router can handle them. Returns false when
 * no WEB_DIST is configured (dev mode: Vite serves the SPA separately).
 */
function serveStatic(webDist: string | null, pathname: string, res: http.ServerResponse): boolean {
  if (!webDist) return false;

  // Resolve + contain within the dist dir (no path traversal).
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(webDist, rel);
  if (!resolved.startsWith(path.resolve(webDist))) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  let filePath = resolved;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: anything that isn't a real file is handled by the client
    // router, so serve index.html. (A missing hashed asset still 404s below.)
    const looksLikeAsset = path.extname(rel) !== '';
    if (looksLikeAsset) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return true;
    }
    filePath = path.join(webDist, 'index.html');
    if (!fs.existsSync(filePath)) return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // index.html must not be cached (hashed assets can be).
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(body);
  return true;
}

/** Build the per-domain handlers over seeded fake bundles. */
function buildRoutes(fx: Fixture, authFx: AuthFixture): { match: (p: string) => LambdaFn | null } {
  const patient = patientHandler(fx.patient.deps) as unknown as LambdaFn;
  const followup = followupHandler(fx.followup.deps) as unknown as LambdaFn;
  const dose = doseHandler(fx.dose.deps) as unknown as LambdaFn;
  const hospital = hospitalHandler(fx.hospital.deps) as unknown as LambdaFn;
  const admin = adminHandler(fx.admin.deps) as unknown as LambdaFn;
  const chat = chatHandler(fx.chat.deps) as unknown as LambdaFn;
  const auth = authHandler(authFx.deps) as unknown as LambdaFn;

  return {
    match(pathname: string): LambdaFn | null {
      if (pathname.startsWith('/auth/')) return auth;
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
  const authFx = makeAuthFixture();
  const routes = buildRoutes(fx, authFx);

  // When WEB_DIST is set (demo deploy), the harness also serves the built SPA
  // from the same origin. Unset in local dev (Vite serves the SPA on :5173).
  const webDist = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null;

  // Permissive CORS for local dev only: the Vite SPA (localhost:5173) calls
  // this harness (localhost:4000) cross-origin. NOT for any real deployment.
  const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        // Answer CORS preflight without hitting a handler.
        if (req.method === 'OPTIONS') {
          res.writeHead(204, CORS_HEADERS);
          res.end();
          return;
        }
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);
        const body = await readBody(req);
        const handler = routes.match(url.pathname);
        if (!handler) {
          // Not an API route: try serving the built SPA (single-process demo).
          if (req.method === 'GET' && serveStatic(webDist, url.pathname, res)) {
            return;
          }
          res.writeHead(404, { 'content-type': 'application/json', ...CORS_HEADERS });
          res.end(
            JSON.stringify({
              success: false,
              data: null,
              error: { code: 'NOT_FOUND', message: 'No route' },
            })
          );
          return;
        }
        const result = await handler(
          await toEvent(req, url.pathname, url.searchParams, body, authFx)
        );
        res.writeHead(result.statusCode, {
          'content-type': 'application/json',
          ...result.headers,
          ...CORS_HEADERS,
        });
        res.end(result.body);
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json', ...CORS_HEADERS });
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
    if (webDist) {
      console.log(`[harness] serving SPA from ${webDist}`);
    }
    console.log(
      `[harness] dev OTP login: phone ${AUTH_PHONES.patient} (patient) or ${AUTH_PHONES.doctor} (doctor), code ${DEV_OTP}`
    );
  });
  return server;
}

const PORT = Number(process.env.PORT ?? 4000);
startServer(PORT);
