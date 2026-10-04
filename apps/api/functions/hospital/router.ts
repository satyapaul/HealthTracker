/**
 * Route dispatch for the hospital (read/picker) domain. Maps thrown AppErrors
 * to the standard error envelope.
 */
import type { HospitalDeps } from './deps';
import type { HospitalRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import { handleGetPicker } from './handlers/get-picker';
import { handleGetHospital } from './handlers/get-hospital';
import { handleGetMyAffiliations } from './handlers/get-my-affiliations';

type RouteHandler = (deps: HospitalDeps, req: HospitalRequest) => Promise<HttpResponse>;

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

  if (p === '/hospitals') {
    if (m === 'GET') return { handler: handleGetPicker, pathParams: {} };
    return null;
  }

  if (p === '/doctors/me/affiliations') {
    if (m === 'GET') return { handler: handleGetMyAffiliations, pathParams: {} };
    return null;
  }

  const detailMatch = /^\/hospitals\/([^/]+)$/.exec(p);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (m === 'GET') return { handler: handleGetHospital, pathParams: { id } };
    return null;
  }

  return null;
}

export async function route(deps: HospitalDeps, req: HospitalRequest): Promise<HttpResponse> {
  const routeKey = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  try {
    const match = resolve(req.method, req.path);
    if (!match) {
      throw new AppError('NOT_FOUND', 'Unknown route');
    }
    const reqWithParams: HospitalRequest = { ...req, pathParams: match.pathParams };
    return await match.handler(deps, reqWithParams);
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('hospital.request.error', { route: routeKey, code: err.code });
    } else {
      deps.logger.error('hospital.request.unexpected', { route: routeKey });
    }
    return respondError(err);
  }
}
