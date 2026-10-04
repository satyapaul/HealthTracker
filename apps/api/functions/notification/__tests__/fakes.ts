/**
 * In-memory fakes for the notification ports. No real IO. Capture enqueued
 * messages, inserted in-app rows, and delivery receipts so tests can assert
 * routing, dedup ids, PHI-free payloads, and idempotent delivery.
 */
import type { DispatcherDeps, SenderDeps } from '../deps';
import type {
  ChannelProvider,
  DeliveryPort,
  DeliveryStatus,
  DispatcherDbPort,
  DbTransactor,
  QueuePort,
  TargetUser,
} from '../ports';
import type { Channel, ChannelMessage, EventType, FifoCoordinates } from '../events';
import type { Logger } from '../logger';

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export class FakeIds {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
}

/** Dispatcher DB fake: configurable targets + captured in-app inserts. */
export class FakeDispatcherDb implements DbTransactor, DispatcherDbPort {
  /** eventType -> target users (set per test). */
  public targetsByEvent = new Map<EventType, TargetUser[]>();
  public inserted: {
    id: string;
    userId: string;
    eventType: EventType;
    payload: Record<string, unknown>;
  }[] = [];

  async transaction<T>(fn: (repo: DispatcherDbPort) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async setSessionContext(): Promise<void> {
    /* no-op */
  }
  async resolveTargets(eventType: EventType): Promise<TargetUser[]> {
    return this.targetsByEvent.get(eventType) ?? [];
  }
  async insertNotification(input: {
    id: string;
    userId: string;
    eventType: EventType;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.inserted.push(input);
  }
}

/** Captures every enqueue with its FIFO coordinates. */
export class FakeQueue implements QueuePort {
  public sent: { message: ChannelMessage; fifo: FifoCoordinates }[] = [];
  async enqueue(message: ChannelMessage, fifo: FifoCoordinates): Promise<void> {
    this.sent.push({ message, fifo });
  }
}

export function makeDispatcherBundle(now?: Date): {
  deps: DispatcherDeps;
  db: FakeDispatcherDb;
  queue: FakeQueue;
} {
  const db = new FakeDispatcherDb();
  const queue = new FakeQueue();
  const deps: DispatcherDeps = {
    db,
    queue,
    ids: new FakeIds(),
    clock: new FixedClock(now ?? new Date('2026-08-16T10:42:00.000Z')),
    logger: noopLogger,
    config: { appBaseUrl: 'https://app.postopcare.in', appName: 'PostOp Care' },
  };
  return { deps, db, queue };
}

// ── Sender-side fakes ─────────────────────────────────────────────────────────

/** In-memory delivery store (DynamoDB stand-in), idempotent by messageId. */
export class FakeDelivery implements DeliveryPort {
  public records = new Map<string, { channel: Channel; status: DeliveryStatus }>();
  async alreadyDelivered(messageId: string): Promise<boolean> {
    const r = this.records.get(messageId);
    return r?.status === 'sent';
  }
  async record(messageId: string, channel: Channel, status: DeliveryStatus): Promise<void> {
    this.records.set(messageId, { channel, status });
  }
}

/** Records every provider send; can be configured to throw once. */
export class FakeProvider implements ChannelProvider {
  public sent: ChannelMessage[] = [];
  public failTimes = 0;
  async send(message: ChannelMessage): Promise<void> {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error('provider error');
    }
    this.sent.push(message);
  }
}

export function makeSenderBundle(): {
  deps: SenderDeps;
  provider: FakeProvider;
  delivery: FakeDelivery;
} {
  const provider = new FakeProvider();
  const delivery = new FakeDelivery();
  const deps: SenderDeps = { provider, delivery, logger: noopLogger };
  return { deps, provider, delivery };
}
