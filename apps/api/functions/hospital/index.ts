/**
 * hospital Lambda entry (WP 3.3 — spec §7.0, LLD §4.16).
 *
 * Thin entry: build deps, adapt the API Gateway event (incl. the WP 1.2
 * authorizer context) to an internal HospitalRequest, delegate to the router.
 */
import type { HospitalDeps } from './deps';
import type { HospitalRequest, Principal, UserRole } from './http';
import { buildDeps } from './factory';
import { route } from './router';

export interface ApiGatewayEvent {
  httpMethod?: string;
  path?: string;
  rawPath?: string;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    http?: { method?: string; path?: string };
    authorizer?: {
      lambda?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
}

export interface ApiGatewayResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractPrincipal(event: ApiGatewayEvent): Principal | null {
  const authz = event.requestContext?.authorizer;
  if (!authz) return null;
  const ctx = (authz.lambda as Record<string, unknown> | undefined) ?? authz;
  const userId = asString(ctx.userId);
  const role = asString(ctx.role);
  const patientId = asString(ctx.patientId);
  if (!userId || !role || !(VALID_ROLES as readonly string[]).includes(role)) {
    return null;
  }
  return { userId, role: role as UserRole, patientId: patientId ?? '' };
}

function toHospitalRequest(event: ApiGatewayEvent): HospitalRequest {
  const method = event.httpMethod ?? event.requestContext?.http?.method ?? 'GET';
  const path = event.path ?? event.rawPath ?? event.requestContext?.http?.path ?? '/';
  return {
    method,
    path,
    headers: event.headers ?? {},
    body: event.body ?? null,
    principal: extractPrincipal(event),
    pathParams: event.pathParameters ?? {},
    query: event.queryStringParameters ?? {},
  };
}

let cachedDeps: HospitalDeps | undefined;

function getDeps(): HospitalDeps {
  if (!cachedDeps) {
    cachedDeps = buildDeps(process.env);
  }
  return cachedDeps;
}

export const handler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
  const deps = getDeps();
  const res = await route(deps, toHospitalRequest(event));
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
};

/** Exposed for testing the entry adapter with injected deps. */
export const handlerWithDeps = (deps: HospitalDeps) => {
  return async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const res = await route(deps, toHospitalRequest(event));
    return { statusCode: res.statusCode, headers: res.headers, body: res.body };
  };
};
