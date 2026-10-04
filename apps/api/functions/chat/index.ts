/**
 * chat Lambda entry (WP 5.1 — spec §7.8, LLD §4.19).
 *
 * Backs two trigger shapes:
 *   - WebSocket `sendMessage` action (established connection; principal resolved
 *     from the Redis ws:conn store by the real adapter) -> wsSendMessage.
 *   - HTTP API `/chat/*` GET reads (behind the WP 1.2 authorizer) -> httpHandler.
 *
 * Thin entry: build deps, delegate to the service. All logic + authz live in
 * chat-service, which takes deps as parameters so unit tests inject fakes.
 *
 * NOTE: the ChatFn + WebSocket routes are not yet wired in ComputeStack (a
 * deferred infra task for the v1.7 chat additions); this is the application
 * code those will invoke.
 */
import type { ChatDeps } from './deps';
import { AppError, respondError, respondOk, type HttpResponse } from './envelope';
import { buildDeps } from './factory';
import {
  sendMessage,
  listThreads,
  listMessages,
  markRead,
  typing,
  type Principal,
  type SendMessageCommand,
  type MarkReadCommand,
  type TypingCommand,
} from './services/chat-service';

type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

// ── HTTP reads (/chat/threads/{patientId}, /chat/threads/{threadId}/messages) ──
export interface ApiGatewayEvent {
  httpMethod?: string;
  path?: string;
  rawPath?: string;
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    http?: { method?: string; path?: string };
    authorizer?: { lambda?: Record<string, unknown>; [key: string]: unknown };
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function extractPrincipal(event: ApiGatewayEvent): Principal | null {
  const authz = event.requestContext?.authorizer;
  if (!authz) return null;
  const ctx = (authz.lambda as Record<string, unknown> | undefined) ?? authz;
  const userId = asString(ctx.userId);
  const role = asString(ctx.role);
  const patientId = asString(ctx.patientId);
  if (!userId || !role || !(VALID_ROLES as readonly string[]).includes(role)) return null;
  return { userId, role: role as UserRole, patientId: patientId ?? '' };
}

function normalizePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

async function routeHttp(deps: ChatDeps, event: ApiGatewayEvent): Promise<HttpResponse> {
  const principal = extractPrincipal(event);
  if (!principal) {
    return respondError(new AppError('UNAUTHENTICATED', 'Authentication required'));
  }
  const method = (event.httpMethod ?? event.requestContext?.http?.method ?? 'GET').toUpperCase();
  const path = normalizePath(
    event.path ?? event.rawPath ?? event.requestContext?.http?.path ?? '/'
  );

  try {
    const threadsMatch = /^\/chat\/threads\/([^/]+)$/.exec(path);
    if (threadsMatch && method === 'GET') {
      const threads = await listThreads(deps, principal, decodeURIComponent(threadsMatch[1]));
      return respondOk({ threads });
    }
    const messagesMatch = /^\/chat\/threads\/([^/]+)\/messages$/.exec(path);
    if (messagesMatch && method === 'GET') {
      const messages = await listMessages(deps, principal, decodeURIComponent(messagesMatch[1]));
      return respondOk({ messages });
    }
    throw new AppError('NOT_FOUND', 'Unknown route');
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('chat.http.error', { code: err.code });
    } else {
      deps.logger.error('chat.http.unexpected', {});
    }
    return respondError(err);
  }
}

let cachedDeps: ChatDeps | undefined;
function getDeps(): ChatDeps {
  if (!cachedDeps) cachedDeps = buildDeps(process.env);
  return cachedDeps;
}

/** HTTP entry for /chat/* reads. */
export const handler = async (event: ApiGatewayEvent): Promise<HttpResponse> => {
  return routeHttp(getDeps(), event);
};

export const handlerWithDeps = (deps: ChatDeps) => {
  return (event: ApiGatewayEvent): Promise<HttpResponse> => routeHttp(deps, event);
};

// ── WebSocket actions (sendMessage / markRead / typing) ───────────────────────
// Thin pass-throughs the WebSocket route adapter invokes once it has resolved
// the principal from the Redis ws:conn store.
export async function wsSendMessage(deps: ChatDeps, principal: Principal, cmd: SendMessageCommand) {
  return sendMessage(deps, principal, cmd);
}

export async function wsMarkRead(deps: ChatDeps, principal: Principal, cmd: MarkReadCommand) {
  return markRead(deps, principal, cmd);
}

export async function wsTyping(deps: ChatDeps, principal: Principal, cmd: TypingCommand) {
  return typing(deps, principal, cmd);
}
