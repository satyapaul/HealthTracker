/**
 * Typed API client for the PostOpCare backend.
 *
 * Every endpoint returns the standard envelope (conventions.md / LLD §3):
 *   success: { success: true,  data: T,    error: null }
 *   failure: { success: false, data: null, error: { code, message, details? } }
 *
 * This client unwraps that envelope: it returns `data` on success and throws a
 * typed ApiError on failure (or on a transport/non-JSON error). The base URL is
 * config-driven (runtimeConfig.apiBaseUrl) so the same build targets the local
 * harness or a real deployment. Auth is a Bearer session token (LLD §3).
 */
import { runtimeConfig } from '../config/runtime';
import { getSessionToken } from './session';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorBody | null;
}

/** Thrown for any non-success outcome. `code` is the stable backend error code. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body; serialized automatically. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override/skip auth (public auth callbacks). Defaults to attaching the token when present. */
  auth?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(
    path.startsWith('http') ? path : `${runtimeConfig.apiBaseUrl}${path}`,
    // base is only used when path is relative in non-browser contexts
    runtimeConfig.apiBaseUrl || 'http://localhost'
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getSessionToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // Network/transport failure (CORS, offline, aborted).
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError('NETWORK_ERROR', message, 0);
  }

  // Parse the envelope. A non-JSON body is itself an error.
  let envelope: Envelope<T> | null = null;
  const text = await res.text();
  if (text) {
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      envelope = null;
    }
  }

  if (!envelope) {
    throw new ApiError(
      'BAD_RESPONSE',
      `Unexpected non-JSON response (HTTP ${res.status})`,
      res.status
    );
  }

  if (!res.ok || !envelope.success || envelope.error) {
    const e = envelope.error;
    throw new ApiError(
      e?.code ?? 'UNKNOWN_ERROR',
      e?.message ?? `Request failed (HTTP ${res.status})`,
      res.status,
      e?.details
    );
  }

  return envelope.data as T;
}

/** Convenience verbs. */
export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
};
