/**
 * Standard API response envelope + typed errors (conventions.md, LLD §3 / §9.2).
 * Mirrors the other domains' envelope — the project's single response contract.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  data: null;
  error: ApiErrorBody;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;

export const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
};

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    this.details = details;
  }
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data, error: null };
}

export function fail(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ApiError {
  return { success: false, data: null, error: { code, message, ...(details ? { details } : {}) } };
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function respondOk<T>(data: T, statusCode = 200): HttpResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(ok(data)) };
}

export function respondError(err: unknown): HttpResponse {
  if (err instanceof AppError) {
    return {
      statusCode: err.status,
      headers: JSON_HEADERS,
      body: JSON.stringify(fail(err.code, err.message, err.details)),
    };
  }
  return {
    statusCode: 500,
    headers: JSON_HEADERS,
    body: JSON.stringify(fail('SERVICE_UNAVAILABLE', 'Internal error')),
  };
}
