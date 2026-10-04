/**
 * WP 5.1 websocket $connect / $disconnect tests. Injected fakes — no API GW /
 * Redis.
 */
import { describe, it, expect } from 'vitest';
import { handlerWithDeps, type WsEvent } from '../index';
import type { WebsocketDeps, SessionValidator, ConnStore, SessionInfo } from '../ports';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

class FakeSessions implements SessionValidator {
  constructor(private valid: Map<string, SessionInfo> = new Map()) {}
  add(token: string, info: SessionInfo): void {
    this.valid.set(token, info);
  }
  async validate(token: string): Promise<SessionInfo | null> {
    return this.valid.get(token) ?? null;
  }
}

class FakeConnStore implements ConnStore {
  public stored = new Map<string, SessionInfo>();
  public removed: string[] = [];
  async put(connectionId: string, info: SessionInfo): Promise<void> {
    this.stored.set(connectionId, info);
  }
  async remove(connectionId: string): Promise<void> {
    this.removed.push(connectionId);
    this.stored.delete(connectionId);
  }
}

function makeDeps(): { deps: WebsocketDeps; sessions: FakeSessions; conns: FakeConnStore } {
  const sessions = new FakeSessions();
  const conns = new FakeConnStore();
  const deps: WebsocketDeps = { sessions, connections: conns, logger: noopLogger };
  return { deps, sessions, conns };
}

function connectEvent(connectionId: string, token?: string): WsEvent {
  return {
    requestContext: { connectionId, routeKey: '$connect' },
    queryStringParameters: token ? { token } : {},
  };
}

describe('$connect', () => {
  it('accepts a valid token and stores the connection', async () => {
    const { deps, sessions, conns } = makeDeps();
    sessions.add('good', { userId: 'u1', role: 'doctor' });
    const res = await handlerWithDeps(deps)(connectEvent('c1', 'good'));
    expect(res.statusCode).toBe(200);
    expect(conns.stored.get('c1')).toEqual({ userId: 'u1', role: 'doctor' });
  });

  it('rejects a missing token (401)', async () => {
    const { deps, conns } = makeDeps();
    const res = await handlerWithDeps(deps)(connectEvent('c1'));
    expect(res.statusCode).toBe(401);
    expect(conns.stored.size).toBe(0);
  });

  it('rejects an invalid token (401)', async () => {
    const { deps, conns } = makeDeps();
    const res = await handlerWithDeps(deps)(connectEvent('c1', 'bad'));
    expect(res.statusCode).toBe(401);
    expect(conns.stored.size).toBe(0);
  });
});

describe('$disconnect', () => {
  it('clears the connection and returns 200', async () => {
    const { deps, conns } = makeDeps();
    conns.stored.set('c1', { userId: 'u1', role: 'doctor' });
    const res = await handlerWithDeps(deps)({
      requestContext: { connectionId: 'c1', routeKey: '$disconnect' },
    });
    expect(res.statusCode).toBe(200);
    expect(conns.removed).toEqual(['c1']);
  });
});
