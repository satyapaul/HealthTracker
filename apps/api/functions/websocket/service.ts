/**
 * WebSocket $connect / $disconnect logic (WP 5.1 — LLD §4.15).
 *
 * $connect validates the session token (from the ?token= query param) and
 * records the connection; an invalid token rejects the upgrade (401).
 * $disconnect clears the connection records. Deps are injected so unit tests
 * run without API Gateway or Redis.
 */
import type { WebsocketDeps } from './ports';

export interface ConnectResult {
  statusCode: number;
}

/** Handle $connect: validate token, store connection, allow/deny the upgrade. */
export async function handleConnect(
  deps: WebsocketDeps,
  connectionId: string,
  token: string | null
): Promise<ConnectResult> {
  if (!token || token.trim() === '') {
    deps.logger.info('ws.connect.denied', { reason: 'missing_token' });
    return { statusCode: 401 };
  }
  const session = await deps.sessions.validate(token);
  if (!session) {
    deps.logger.info('ws.connect.denied', { reason: 'invalid_token' });
    return { statusCode: 401 };
  }
  await deps.connections.put(connectionId, session);
  deps.logger.info('ws.connect.ok', { userId: session.userId, role: session.role });
  return { statusCode: 200 };
}

/** Handle $disconnect: clear the connection records. Always 200. */
export async function handleDisconnect(
  deps: WebsocketDeps,
  connectionId: string
): Promise<ConnectResult> {
  await deps.connections.remove(connectionId);
  deps.logger.info('ws.disconnect', {});
  return { statusCode: 200 };
}
