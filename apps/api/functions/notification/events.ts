/**
 * Notification event + channel types (WP 4.1 — LLD §6.2).
 *
 * The dispatcher consumes NotificationEvent from the internal notification-
 * events queue and fans each out to per-channel FIFO queues. Channel payloads
 * carry NO PHI — only template names, non-PHI params, and deep links.
 */

/** Event types the dispatcher routes (LLD §4.7 / §6.2). */
export type EventType =
  | 'FOLLOWUP_SUBMITTED'
  | 'DOCTOR_RESPONDED'
  | 'MILESTONE_OVERDUE'
  | 'ATTACHMENT_QUARANTINED'
  | 'ChatMessageReceived'
  | 'DoctorAuthorized'
  | 'AccessRevoked'
  | 'CaseTransferInitiated'
  | 'CaseTransferCompleted';

/** The four delivery channels. */
export type Channel = 'inapp' | 'email' | 'sms' | 'whatsapp';

export const ALL_CHANNELS: readonly Channel[] = ['inapp', 'email', 'sms', 'whatsapp'];

/** Inbound event (notification-events standard queue). */
export interface NotificationEvent {
  eventId: string;
  eventType: EventType;
  patientId: string;
  actorId?: string;
  timestamp?: string;
  /** Event-specific, NON-PHI data (ids, deep-link params, template hints). */
  payload: Record<string, unknown>;
}

/**
 * A per-channel outbound message. The dispatcher builds one of these per target
 * user per enabled channel. The `dedupId` is the SQS FIFO
 * MessageDeduplicationId ({notificationId}#{channel}); `groupId` is the FIFO
 * MessageGroupId (per-user ordering).
 */
export interface ChannelMessage {
  messageId: string;
  channel: Channel;
  /** The in-app notification row id (dedup basis for event-driven sends). */
  notificationId: string;
  /** Target user id (never a phone/email in logs; resolved by the sender). */
  userId: string;
  patientId: string;
  eventType: EventType;
  /** Template id/name the sender renders — NOT a rendered PHI body. */
  template: string;
  /** Non-PHI template params (deep link, formatted date, app name). */
  templateParams: Record<string, string>;
  enqueuedAt: string;
}

/** SQS FIFO coordinates for a channel message. */
export interface FifoCoordinates {
  dedupId: string;
  groupId: string;
}

/** Build the dedup id for an event-driven notification (LLD §6.2 FIFO rule). */
export function dedupIdFor(notificationId: string, channel: Channel): string {
  return `${notificationId}#${channel}`;
}

/** FIFO group id: per-user ordering so a user's messages stay in order. */
export function groupIdFor(userId: string, channel: Channel): string {
  return `${channel}:${userId}`;
}
