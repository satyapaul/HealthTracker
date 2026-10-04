/**
 * patient Lambda entry (WP 2.1 — spec §7.1).
 *
 * Thin entry: build deps from env, adapt the API Gateway event (including the
 * WP 1.2 authorizer context) to an internal PatientRequest, delegate to the
 * router. All business logic + error mapping live in the router/handlers/
 * service, which take deps as parameters so unit tests inject fakes.
 */
import type { PatientDeps } from './deps';
import type { PatientRequest, Principal, UserRole } from './http';
import { buildDeps } from './factory';
import { route } from './router';

/**
 * Structural subset of the API Gateway proxy event. Supports REST (v1) and HTTP
 * API (v2) shapes. The authorizer attaches { userId, role, patientId } to the
 * authorizer context; for a v2 SIMPLE Lambda authorizer that lands under
 * requestContext.authorizer.lambda.
 */
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
      // REST (v1) custom authorizers expose the context directly here.
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

/** Extract the authenticated principal from the authorizer context, if present. */
function extractPrincipal(event: ApiGatewayEvent): Principal | null {
  const authz = event.requestContext?.authorizer;
  if (!authz) return null;
  // v2 SIMPLE authorizer: context under `.lambda`; v1: directly on `.authorizer`.
  const ctx = (authz.lambda as Record<string, unknown> | undefined) ?? authz;

  const userId = asString(ctx.userId);
  const role = asString(ctx.role);
  const patientId = asString(ctx.patientId);

  if (!userId || !role || !(VALID_ROLES as readonly string[]).includes(role)) {
    return null;
  }
  return { userId, role: role as UserRole, patientId: patientId ?? '' };
}

function toPatientRequest(event: ApiGatewayEvent): PatientRequest {
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

/** Cached deps across warm invocations. */
let cachedDeps: PatientDeps | undefined;

function getDeps(): PatientDeps {
  if (!cachedDeps) {
    cachedDeps = buildDeps(process.env);
  }
  return cachedDeps;
}

export const handler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
  const deps = getDeps();
  const res = await route(deps, toPatientRequest(event));
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
};

// Exposed for testing the entry adapter with injected deps.
export const handlerWithDeps = (deps: PatientDeps) => {
  return async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const res = await route(deps, toPatientRequest(event));
    return { statusCode: res.statusCode, headers: res.headers, body: res.body };
  };
};
