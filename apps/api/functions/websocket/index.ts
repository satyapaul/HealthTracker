/**
 * websocket Lambda entry (WP 5.1 — LLD §4.15). Handles the WebSocket
 * $connect / $disconnect routes. Thin entry: build deps, read the connection id
 * + token from the API Gateway event, delegate to the service.
 */
import type { WebsocketDeps } from './ports';
import { buildDeps } from './factory';
import { handleConnect, handleDisconnect } from './service';

export interface WsEvent {
  requestContext?: {
    connectionId?: string;
    routeKey?: string; // '$connect' | '$disconnect'
  };
  queryStringParameters?: Record<string, string | undefined> | null;
}

export interface WsResult {
  statusCode: number;
}

async function dispatch(deps: WebsocketDeps, event: WsEvent): Promise<WsResult> {
  const connectionId = event.requestContext?.connectionId ?? '';
  const routeKey = event.requestContext?.routeKey ?? '';
  if (routeKey === '$disconnect') {
    return handleDisconnect(deps, connectionId);
  }
  // Default to $connect semantics (the only other lifecycle route here).
  const token = event.queryStringParameters?.token ?? null;
  return handleConnect(deps, connectionId, token);
}

let cachedDeps: WebsocketDeps | undefined;
function getDeps(): WebsocketDeps {
  if (!cachedDeps) {
    cachedDeps = buildDeps(process.env);
  }
  return cachedDeps;
}

export const handler = async (event: WsEvent): Promise<WsResult> => {
  return dispatch(getDeps(), event);
};

/** Exposed for testing the entry adapter with injected deps. */
export const handlerWithDeps = (deps: WebsocketDeps) => {
  return async (event: WsEvent): Promise<WsResult> => dispatch(deps, event);
};
