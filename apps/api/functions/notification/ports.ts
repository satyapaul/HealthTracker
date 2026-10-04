/**
 * Ports for the notification dispatcher + senders (WP 4.1).
 *
 * All AWS primitives (SQS FIFO, SES/SMS/WhatsApp providers, DynamoDB delivery
 * receipts, API GW WebSocket) sit behind these interfaces so the dispatch and
 * delivery logic is unit-testable; the concrete adapters are deferred to infra.
 */
import type { Channel, ChannelMessage, EventType, FifoCoordinates } from './events';

/** A target user with their resolved channel preferences. */
export interface TargetUser {
  userId: string;
  /** Enabled channels for this user (prefs + contact availability applied). */
  enabledChannels: Channel[];
}

/** Dispatcher DB access: resolve targets, write in-app rows. */
export interface DispatcherDbPort {
  setSessionContext(ctx: { userId: string; role: 'admin'; patientId: null }): Promise<void>;

  /** Resolve the target users for an event + their enabled channels. */
  resolveTargets(eventType: EventType, patientId: string): Promise<TargetUser[]>;

  /** Insert an in-app notification row; returns the new notification id. */
  insertNotification(input: {
    id: string;
    userId: string;
    eventType: EventType;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

/** SQS FIFO enqueue. */
export interface QueuePort {
  /**
   * Enqueue a channel message to its FIFO queue with the given dedup/group ids.
   * SQS collapses messages sharing a MessageDeduplicationId within the 5-minute
   * window, so a duplicate dispatch of the same (notificationId, channel) is
   * delivered at most once.
   */
  enqueue(message: ChannelMessage, fifo: FifoCoordinates): Promise<void>;
}

/** Dispatcher dependency bundle entrypoint for DB work. */
export interface DbTransactor {
  transaction<T>(fn: (repo: DispatcherDbPort) => Promise<T>): Promise<T>;
}

/** ID + clock ports for determinism in tests. */
export interface IdGenerator {
  uuid(): string;
}
export interface Clock {
  now(): Date;
}

// ── Sender-side ports ─────────────────────────────────────────────────────────

/** The outcome of attempting a provider send. */
export type DeliveryStatus = 'sent' | 'failed';

/**
 * Delivery-receipt store (DynamoDB auth/delivery table). Keyed by messageId so
 * delivery is IDEMPOTENT: a message already marked 'sent' is never re-sent even
 * if SQS redelivers it (belt-and-suspenders alongside FIFO dedup).
 */
export interface DeliveryPort {
  /** True if this messageId was already delivered (any terminal status). */
  alreadyDelivered(messageId: string): Promise<boolean>;
  /** Record the delivery outcome for this messageId. */
  record(messageId: string, channel: Channel, status: DeliveryStatus): Promise<void>;
}

/** A channel provider (SES, SMS gateway, WhatsApp API, WebSocket push). */
export interface ChannelProvider {
  /** Send one message. Throws on a hard provider error (triggers retry/DLQ). */
  send(message: ChannelMessage): Promise<void>;
}
