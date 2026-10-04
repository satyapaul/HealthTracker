/**
 * Route dispatch for the milestone domain (doctor create/list).
 */
import type { MilestoneDeps } from './deps';
import type { MilestoneRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import { handleCreateMilestone } from './handlers/create-milestone';
import { handleListMilestones } from './handlers/list-milestones';

type RouteHandler = (deps: MilestoneDeps, req: MilestoneRequest) => Promise<HttpResponse>;

function normalizePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

function resolve(method: string, path: string): { handler: RouteHandler } | null {
  const m = method.toUpperCase();
  const p = normalizePath(path);
  if (p === '/milestones') {
    if (m === 'POST') return { handler: handleCreateMilestone };
    if (m === 'GET') return { handler: handleListMilestones };
  }
  return null;
}

export async function route(deps: MilestoneDeps, req: MilestoneRequest): Promise<HttpResponse> {
  const routeKey = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  try {
    const match = resolve(req.method, req.path);
    if (!match) {
      throw new AppError('NOT_FOUND', 'Unknown route');
    }
    return await match.handler(deps, req);
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('milestone.request.error', { route: routeKey, code: err.code });
    } else {
      deps.logger.error('milestone.request.unexpected', { route: routeKey });
    }
    return respondError(err);
  }
}
