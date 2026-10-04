/**
 * Build dependency bundles for the dispatcher and the channel senders from the
 * Lambda environment. All AWS adapters (SQS, SES/SMS/WhatsApp providers,
 * DynamoDB delivery store, WebSocket push, DB) are not-wired stubs here; the
 * real adapters are wired in the infra step. Unit tests inject fakes directly.
 */
import { randomUUID } from 'node:crypto';
import type { DispatcherDeps, SenderDeps } from './deps';
import type {
  ChannelProvider,
  DbTransactor,
  DeliveryPort,
  DispatcherDbPort,
  QueuePort,
} from './ports';
import type { Channel } from './events';
import { consoleLogger } from './logger';

function notWiredDb(): DbTransactor {
  const fail = (): never => {
    throw new Error('notification DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: DispatcherDbPort) => Promise<T>): Promise<T> {
      const repo: DispatcherDbPort = {
        setSessionContext: async () => fail(),
        resolveTargets: async () => fail(),
        insertNotification: async () => fail(),
      };
      return fn(repo);
    },
  };
}

function notWiredQueue(): QueuePort {
  return {
    async enqueue() {
      throw new Error('SQS adapter is not wired yet');
    },
  };
}

function notWiredDelivery(): DeliveryPort {
  return {
    async alreadyDelivered() {
      throw new Error('delivery-receipt adapter is not wired yet');
    },
    async record() {
      throw new Error('delivery-receipt adapter is not wired yet');
    },
  };
}

function notWiredProvider(_channel: Channel): ChannelProvider {
  return {
    async send() {
      throw new Error('channel provider is not wired yet');
    },
  };
}

export function buildDispatcherDeps(env: NodeJS.ProcessEnv = process.env): DispatcherDeps {
  return {
    db: notWiredDb(),
    queue: notWiredQueue(),
    ids: { uuid: () => randomUUID() },
    clock: { now: () => new Date() },
    logger: consoleLogger,
    config: {
      appBaseUrl: env.APP_BASE_URL ?? 'https://app.postopcare.in',
      appName: env.APP_NAME ?? 'PostOp Care',
    },
  };
}

export function buildSenderDeps(channel: Channel): SenderDeps {
  return {
    provider: notWiredProvider(channel),
    delivery: notWiredDelivery(),
    logger: consoleLogger,
  };
}
