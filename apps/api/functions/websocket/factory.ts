/**
 * Build the websocket Lambda deps from the environment. The session validator
 * (Redis session lookup / JWT verify) and the Redis connection store are
 * not-wired stubs; real adapters are deferred to infra. Unit tests inject
 * fakes directly.
 */
import type { WebsocketDeps, SessionValidator, ConnStore } from './ports';

function emit(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields?: Record<string, unknown>
): void {
  const line = JSON.stringify({ level, event, ...fields, ts: new Date().toISOString() });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

const logger = {
  info: (e: string, f?: Record<string, unknown>) => emit('info', e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit('warn', e, f),
  error: (e: string, f?: Record<string, unknown>) => emit('error', e, f),
};

function notWiredSessions(): SessionValidator {
  return {
    async validate() {
      throw new Error('session validator is not wired yet');
    },
  };
}

function notWiredConnStore(): ConnStore {
  return {
    async put() {
      throw new Error('connection store is not wired yet');
    },
    async remove() {
      throw new Error('connection store is not wired yet');
    },
  };
}

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): WebsocketDeps {
  return {
    sessions: notWiredSessions(),
    connections: notWiredConnStore(),
    logger,
  };
}
