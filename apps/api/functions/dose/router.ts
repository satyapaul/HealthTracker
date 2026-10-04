/**
 * Route dispatch for the dose (doctor review) domain. All routes hang off a
 * follow-up row id. Maps thrown AppErrors to the standard error envelope and
 * logs the error CODE only — never PHI.
 */
import type { DoseDeps } from './deps';
import type { DoseRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import { handleSubmitReview } from './handlers/submit-review';
import { handleGetDoseChanges } from './handlers/get-dose-changes';
import { handleGetResponse } from './handlers/get-response';

type RouteHandler = (deps: DoseDeps, req: DoseRequest) => Promise<HttpResponse>;

function normalizePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

function resolve(
  method: string,
  path: string
): { handler: RouteHandler; pathParams: Record<string, string> } | null {
  const m = method.toUpperCase();
  const p = normalizePath(path);

  const responseMatch = /^\/followup\/rows\/([^/]+)\/response$/.exec(p);
  if (responseMatch) {
    const id = decodeURIComponent(responseMatch[1]);
    if (m === 'PUT' || m === 'POST') return { handler: handleSubmitReview, pathParams: { id } };
    if (m === 'GET') return { handler: handleGetResponse, pathParams: { id } };
    return null;
  }

  const doseChangesMatch = /^\/followup\/rows\/([^/]+)\/dose-changes$/.exec(p);
  if (doseChangesMatch) {
    const id = decodeURIComponent(doseChangesMatch[1]);
    if (m === 'GET') return { handler: handleGetDoseChanges, pathParams: { id } };
    return null;
  }

  return null;
}

export async function route(deps: DoseDeps, req: DoseRequest): Promise<HttpResponse> {
  const routeKey = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  try {
    const match = resolve(req.method, req.path);
    if (!match) {
      throw new AppError('NOT_FOUND', 'Unknown route');
    }
    const reqWithParams: DoseRequest = { ...req, pathParams: match.pathParams };
    return await match.handler(deps, reqWithParams);
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('dose.request.error', { route: routeKey, code: err.code });
    } else {
      deps.logger.error('dose.request.unexpected', { route: routeKey });
    }
    return respondError(err);
  }
}
