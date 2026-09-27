/**
 * Thin HTTP request shape decoupled from API Gateway, plus parsing helpers.
 * The Lambda entry adapts the APIGatewayProxyEvent to this shape.
 */
import { AppError } from './envelope';

export interface AuthRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}

/** Parse and return the JSON body as a record, or throw VALIDATION_ERROR. */
export function parseJsonBody(req: AuthRequest): Record<string, unknown> {
  if (!req.body) {
    throw new AppError('VALIDATION_ERROR', 'Request body is required');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Require a non-empty string field, else VALIDATION_ERROR. */
export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' is required`, { field });
  }
  return value;
}

/** Extract the bearer token from the Authorization header (case-insensitive). */
export function extractBearerToken(headers: Record<string, string | undefined>): string | null {
  const header =
    headers.authorization ?? headers.Authorization ?? headers.AUTHORIZATION ?? undefined;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
