/**
 * auth Lambda entry (WP 1.1).
 *
 * Responsibilities kept deliberately thin:
 *  1. Build dependencies from the environment (factory).
 *  2. Adapt the API Gateway event -> internal AuthRequest.
 *  3. Delegate to the router (all business logic + error mapping lives there).
 *
 * Core logic takes deps as parameters (see router/handlers), so unit tests
 * inject fakes and never touch real AWS/DB/Redis/HTTP. See docs/LLD §4.1.
 */
import type { AuthDeps } from './deps';
import type { AuthRequest } from './http';
import { buildDeps } from './factory';
import { route } from './router';

/**
 * Structural subset of the API Gateway proxy event. We support both the REST
 * (v1: httpMethod/path) and HTTP API (v2: requestContext.http.{method,path})
 * shapes without pulling in @types/aws-lambda.
 */
export interface ApiGatewayEvent {
  httpMethod?: string;
  path?: string;
  rawPath?: string;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  requestContext?: {
    http?: { method?: string; path?: string };
  };
}

export interface ApiGatewayResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function toAuthRequest(event: ApiGatewayEvent): AuthRequest {
  const method = event.httpMethod ?? event.requestContext?.http?.method ?? 'GET';
  const path = event.path ?? event.rawPath ?? event.requestContext?.http?.path ?? '/';
  return {
    method,
    path,
    headers: event.headers ?? {},
    body: event.body ?? null,
  };
}

/** Cached deps across warm invocations. */
let cachedDeps: AuthDeps | undefined;

function getDeps(): AuthDeps {
  if (!cachedDeps) {
    cachedDeps = buildDeps(process.env);
  }
  return cachedDeps;
}

export const handler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
  const deps = getDeps();
  const res = await route(deps, toAuthRequest(event));
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
};

// Exposed for testing the entry adapter with injected deps.
export const handlerWithDeps = (deps: AuthDeps) => {
  return async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const res = await route(deps, toAuthRequest(event));
    return { statusCode: res.statusCode, headers: res.headers, body: res.body };
  };
};
