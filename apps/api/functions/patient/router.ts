/**
 * Route dispatch for the patient domain. Maps method+path (with a single
 * `/patients/{id}` parameter) to a handler and maps thrown AppErrors to the
 * standard error envelope. Logs the error CODE only — never PHI.
 */
import type { PatientDeps } from './deps';
import type { PatientRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import { handleCreatePatient } from './handlers/create-patient';
import { handleGetPatient } from './handlers/get-patient';
import { handleListPatients } from './handlers/list-patients';
import { handleUpdatePatient } from './handlers/update-patient';

type RouteHandler = (deps: PatientDeps, req: PatientRequest) => Promise<HttpResponse>;

/** Strip trailing slash (except root). */
function normalizePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

/**
 * Resolve a method+path to a handler plus any extracted path params.
 * Collection routes: `/patients`. Item routes: `/patients/{id}`.
 */
function resolve(
  method: string,
  path: string
): { handler: RouteHandler; pathParams: Record<string, string> } | null {
  const m = method.toUpperCase();
  const p = normalizePath(path);

  if (p === '/patients') {
    if (m === 'POST') return { handler: handleCreatePatient, pathParams: {} };
    if (m === 'GET') return { handler: handleListPatients, pathParams: {} };
    return null;
  }

  const itemMatch = /^\/patients\/([^/]+)$/.exec(p);
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1]);
    if (m === 'GET') return { handler: handleGetPatient, pathParams: { id } };
    if (m === 'PATCH') return { handler: handleUpdatePatient, pathParams: { id } };
    return null;
  }

  return null;
}

export async function route(deps: PatientDeps, req: PatientRequest): Promise<HttpResponse> {
  const routeKey = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  try {
    const match = resolve(req.method, req.path);
    if (!match) {
      throw new AppError('NOT_FOUND', 'Unknown route');
    }
    // Merge resolved path params onto the request for handlers to read.
    const reqWithParams: PatientRequest = { ...req, pathParams: match.pathParams };
    return await match.handler(deps, reqWithParams);
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('patient.request.error', { route: routeKey, code: err.code });
    } else {
      deps.logger.error('patient.request.unexpected', { route: routeKey });
    }
    return respondError(err);
  }
}
