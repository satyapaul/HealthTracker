/**
 * Ports for the websocket connection-lifecycle Lambda (WP 5.1 — LLD §4.15).
 *
 * $connect validates the session token and records the connection in Redis;
 * $disconnect clears it. Both the session validation and the Redis store are
 * ports (faked in tests; real adapters deferred to infra).
 */

export interface SessionInfo {
  userId: string;
  role: 'patient' | 'caregiver' | 'doctor' | 'admin';
}

/** Validates the WebSocket session token (from ?token= on $connect). */
export interface SessionValidator {
  /** Resolve a session token to its principal, or null if invalid/expired. */
  validate(token: string): Promise<SessionInfo | null>;
}

/**
 * WebSocket connection store (Redis). Mirrors the LLD §5.2 keys:
 *   ws:conn:{connectionId} -> { userId, role }  (TTL 24h)
 *   ws:user:{userId}       -> connectionId        (TTL 24h)
 */
export interface ConnStore {
  put(connectionId: string, info: SessionInfo): Promise<void>;
  /** Remove by connectionId (resolves the userId internally to clear both keys). */
  remove(connectionId: string): Promise<void>;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface WebsocketDeps {
  sessions: SessionValidator;
  connections: ConnStore;
  logger: Logger;
}
