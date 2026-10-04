/**
 * Notification dispatcher (WP 4.1 — LLD §4.7).
 *
 * For each inbound NotificationEvent:
 *   1. Resolve target users + their enabled channels (by event type).
 *   2. Insert one in-app notifications row per target (durable in-app channel).
 *   3. Enqueue a per-channel message to each enabled channel's FIFO queue with
 *      MessageDeduplicationId = {notificationId}#{channel} and a per-user group
 *      id. SQS FIFO dedup collapses duplicate dispatches within its 5-min
 *      window, so a given (notification, channel) is delivered at most once.
 *
 * NO PHI leaves the dispatcher: channel payloads carry a template id, a deep
 * link, and non-PHI params only (conventions.md). The in-app row payload is
 * likewise PHI-free.
 */
import type { DispatcherDeps } from './deps';
import {
  ALL_CHANNELS,
  dedupIdFor,
  groupIdFor,
  type Channel,
  type ChannelMessage,
  type EventType,
  type NotificationEvent,
} from './events';

/** Per-event template id for a channel (sender renders the actual copy). */
function templateFor(eventType: EventType, channel: Channel): string {
  // Deterministic template id; senders map this to provider-specific templates.
  return `${eventType.toLowerCase()}__${channel}`;
}

/**
 * Build the non-PHI deep link for an event. Links point at app routes keyed by
 * opaque ids only — never names or clinical values.
 */
function deepLinkFor(deps: DispatcherDeps, event: NotificationEvent): string {
  const base = deps.config.appBaseUrl.replace(/\/+$/, '');
  const rowId = typeof event.payload.rowId === 'string' ? event.payload.rowId : '';
  switch (event.eventType) {
    case 'FOLLOWUP_SUBMITTED':
      return `${base}/doctor/patients/${event.patientId}/review/${rowId}`;
    case 'DOCTOR_RESPONDED':
      return `${base}/patient/followup/${rowId}`;
    default:
      return `${base}/`;
  }
}

/** Which channels a given event type is allowed to use (SMS/WA are opt-in). */
function channelsForEvent(eventType: EventType): Channel[] {
  switch (eventType) {
    // In-app + email always; SMS/WhatsApp only for events that warrant them.
    case 'DOCTOR_RESPONDED':
      return ['inapp', 'email', 'sms', 'whatsapp'];
    case 'FOLLOWUP_SUBMITTED':
      return ['inapp', 'email'];
    default:
      return ['inapp', 'email'];
  }
}

export interface DispatchResult {
  eventId: string;
  notificationsCreated: number;
  enqueued: number;
}

/** Dispatch a single notification event. */
export async function dispatchEvent(
  deps: DispatcherDeps,
  event: NotificationEvent
): Promise<DispatchResult> {
  const allowedForEvent = new Set<Channel>(channelsForEvent(event.eventType));

  const result = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext({ userId: 'system', role: 'admin', patientId: null });

    const targets = await repo.resolveTargets(event.eventType, event.patientId);
    const deepLink = deepLinkFor(deps, event);
    const enqueuedAt = deps.clock.now().toISOString();

    let notificationsCreated = 0;
    let enqueued = 0;

    for (const target of targets) {
      // One durable in-app notification row per target (PHI-free payload).
      const notificationId = deps.ids.uuid();
      await repo.insertNotification({
        id: notificationId,
        userId: target.userId,
        eventType: event.eventType,
        payload: {
          eventId: event.eventId,
          patientId: event.patientId,
          deepLink,
          ...(typeof event.payload.rowId === 'string' ? { rowId: event.payload.rowId } : {}),
        },
      });
      notificationsCreated += 1;

      // Enqueue to each channel that is BOTH enabled for the user AND allowed
      // for this event type. inapp is derived from the durable row, but we still
      // enqueue it so the WebSocket push happens via the inapp sender.
      for (const channel of ALL_CHANNELS) {
        if (!allowedForEvent.has(channel)) continue;
        if (!target.enabledChannels.includes(channel)) continue;

        const message: ChannelMessage = {
          messageId: deps.ids.uuid(),
          channel,
          notificationId,
          userId: target.userId,
          patientId: event.patientId,
          eventType: event.eventType,
          template: templateFor(event.eventType, channel),
          templateParams: {
            deepLink,
            appName: deps.config.appName,
          },
          enqueuedAt,
        };
        await deps.queue.enqueue(message, {
          dedupId: dedupIdFor(notificationId, channel),
          groupId: groupIdFor(target.userId, channel),
        });
        enqueued += 1;
      }
    }

    return { notificationsCreated, enqueued };
  });

  deps.logger.info('notification.dispatched', {
    eventId: event.eventId,
    eventType: event.eventType,
    patientId: event.patientId,
    notificationsCreated: result.notificationsCreated,
    enqueued: result.enqueued,
  });

  return { eventId: event.eventId, ...result };
}
