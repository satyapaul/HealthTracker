/**
 * Route dispatch for the admin domain (hospital registry + affiliations).
 * Maps thrown AppErrors to the standard error envelope.
 */
import type { AdminDeps } from './deps';
import type { AdminRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import {
  handleCreateHospital,
  handleUpdateHospital,
  handleSetHospitalStatus,
  handleSearchHospitals,
} from './handlers/hospitals';
import { handleAddAffiliation, handleUpdateAffiliation } from './handlers/affiliations';

type RouteHandler = (deps: AdminDeps, req: AdminRequest) => Promise<HttpResponse>;

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

  if (p === '/admin/hospitals') {
    if (m === 'POST') return { handler: handleCreateHospital, pathParams: {} };
    if (m === 'GET') return { handler: handleSearchHospitals, pathParams: {} };
    return null;
  }

  // /admin/hospitals/{id}/affiliations
  const affMatch = /^\/admin\/hospitals\/([^/]+)\/affiliations$/.exec(p);
  if (affMatch) {
    const id = decodeURIComponent(affMatch[1]);
    if (m === 'POST') return { handler: handleAddAffiliation, pathParams: { id } };
    return null;
  }

  // /admin/hospitals/{id}/status
  const statusMatch = /^\/admin\/hospitals\/([^/]+)\/status$/.exec(p);
  if (statusMatch) {
    const id = decodeURIComponent(statusMatch[1]);
    if (m === 'PATCH') return { handler: handleSetHospitalStatus, pathParams: { id } };
    return null;
  }

  // /admin/hospitals/{id}
  const hospitalMatch = /^\/admin\/hospitals\/([^/]+)$/.exec(p);
  if (hospitalMatch) {
    const id = decodeURIComponent(hospitalMatch[1]);
    if (m === 'PUT') return { handler: handleUpdateHospital, pathParams: { id } };
    return null;
  }

  // /admin/affiliations/{id}
  const affItemMatch = /^\/admin\/affiliations\/([^/]+)$/.exec(p);
  if (affItemMatch) {
    const id = decodeURIComponent(affItemMatch[1]);
    if (m === 'PATCH') return { handler: handleUpdateAffiliation, pathParams: { id } };
    return null;
  }

  return null;
}

export async function route(deps: AdminDeps, req: AdminRequest): Promise<HttpResponse> {
  const routeKey = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  try {
    const match = resolve(req.method, req.path);
    if (!match) {
      throw new AppError('NOT_FOUND', 'Unknown route');
    }
    const reqWithParams: AdminRequest = { ...req, pathParams: match.pathParams };
    return await match.handler(deps, reqWithParams);
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('admin.request.error', { route: routeKey, code: err.code });
    } else {
      deps.logger.error('admin.request.unexpected', { route: routeKey });
    }
    return respondError(err);
  }
}
