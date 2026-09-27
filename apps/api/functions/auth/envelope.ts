/**
 * Standard API response envelope + typed errors (conventions.md, LLD §3 / §9.2).
 *
 * All responses use the envelope:
 *   success: { success: true,  data: {...}, error: null }
 *   error:   { success: false, data: null,  error: { code, message, details? } }
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

/** Stable error codes -> default HTTP status (LLD §9.2). */
export const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INVALID_OTP: 401,
  OTP_EXPIRED: 400,
  OTP_MAX_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
};

export type ErrorCode = keyof typeof ERROR_STATUS;

/**
 * Typed application error. Thrown by services/handlers and mapped to the
 * error envelope at the handler edge. Never carries PHI in its message.
 */
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

/** Serialize a success envelope to an HTTP response. */
export function respondOk<T>(data: T, statusCode = 200): HttpResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(ok(data)) };
}

/** 204 No Content — no envelope body per HTTP semantics. */
export function respondNoContent(): HttpResponse {
  return { statusCode: 204, headers: JSON_HEADERS, body: '' };
}

/** Serialize an AppError (or unknown error) to an HTTP error envelope. */
export function respondError(err: unknown): HttpResponse {
  if (err instanceof AppError) {
    return {
      statusCode: err.status,
      headers: JSON_HEADERS,
      body: JSON.stringify(fail(err.code, err.message, err.details)),
    };
  }
  // Unexpected error: never leak internals/PHI.
  return {
    statusCode: 500,
    headers: JSON_HEADERS,
    body: JSON.stringify(fail('SERVICE_UNAVAILABLE', 'Internal error')),
  };
}
