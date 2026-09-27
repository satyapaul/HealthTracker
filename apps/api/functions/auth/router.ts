/**
 * Route dispatch for the auth domain. Maps method+path to a handler and maps
 * thrown AppErrors to the standard error envelope.
 */
import type { AuthDeps } from './deps';
import type { AuthRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import { handleGoogleCallback, handleXCallback } from './handlers/oauth-callback';
import { handleOtpSend } from './handlers/otp-send';
import { handleOtpVerify } from './handlers/otp-verify';
import { handleDeleteSession } from './handlers/session';
import { handleGetMe } from './handlers/me';

type RouteHandler = (deps: AuthDeps, req: AuthRequest) => Promise<HttpResponse>;

/** Normalize a path: strip trailing slash (except root) and any stage prefix noise. */
function normalizePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

const ROUTES: Record<string, RouteHandler> = {
  'POST /auth/google/callback': handleGoogleCallback,
  'POST /auth/x/callback': handleXCallback,
  'POST /auth/otp/send': handleOtpSend,
  'POST /auth/otp/verify': handleOtpVerify,
  'DELETE /auth/session': handleDeleteSession,
  'GET /auth/me': handleGetMe,
};

export async function route(deps: AuthDeps, req: AuthRequest): Promise<HttpResponse> {
  const key = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  const handler = ROUTES[key];

  try {
    if (!handler) {
      throw new AppError('VALIDATION_ERROR', 'Unknown route');
    }
    return await handler(deps, req);
  } catch (err) {
    if (err instanceof AppError) {
      // Log the error code only — never PHI or the underlying message details.
      deps.logger.warn('auth.request.error', { route: key, code: err.code });
    } else {
      deps.logger.error('auth.request.unexpected', { route: key });
    }
    return respondError(err);
  }
}
