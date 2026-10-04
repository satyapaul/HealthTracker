/**
 * Build the chat domain deps from the environment. DB (RDS Proxy), the API
 * Gateway Management push, the Redis connection lookup, and the SQS event queue
 * are not-wired stubs; real adapters are deferred to infra. Unit tests inject
 * fakes directly.
 */
import { randomUUID } from 'node:crypto';
import type { ChatDeps } from './deps';
import type { ChatRepository, DbPort, ConnectionPush, ChatEventQueue } from './ports';
import { consoleLogger } from './logger';

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('chat DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: ChatRepository) => Promise<T>): Promise<T> {
      const repo: ChatRepository = {
        setSessionContext: async () => fail(),
        findThreadById: async () => fail(),
        listThreads: async () => fail(),
        listMessages: async () => fail(),
        insertMessage: async () => fail(),
        insertAttachment: async () => fail(),
        threadMemberUserIds: async () => fail(),
        ensureCareTeamThread: async () => fail(),
        insertSystemCard: async () => fail(),
        threadAllMemberUserIds: async () => fail(),
        markRead: async () => fail(),
      };
      return fn(repo);
    },
  };
}

function notWiredConnections(): ConnectionPush {
  return {
    async connectionFor() {
      return null; // no connected members until the Redis adapter is wired
    },
    async push() {
      throw new Error('API Gateway Management push is not wired yet');
    },
  };
}

function notWiredQueue(): ChatEventQueue {
  return {
    async chatMessageReceived() {
      throw new Error('chat event queue is not wired yet');
    },
  };
}

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): ChatDeps {
  return {
    db: notWiredDb(),
    connections: notWiredConnections(),
    queue: notWiredQueue(),
    ids: { uuid: () => randomUUID() },
    clock: { now: () => new Date() },
    logger: consoleLogger,
  };
}
