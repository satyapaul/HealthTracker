/**
 * notification Lambda entry (WP 4.1 — LLD §4.7-4.11).
 *
 * One source file backs multiple functions in ComputeStack (see
 * infra/lib/stacks/compute-stack.ts):
 *   - the dispatcher uses the default `handler` (trigger: notification-events)
 *   - each channel sender uses a namespaced export: `sms.handler`,
 *     `whatsapp.handler`, `email.handler`, `inapp.handler`
 *     (trigger: the matching notification-<channel>.fifo queue)
 *
 * Entries are thin: parse the SQS batch, delegate to the dispatcher/sender
 * service with deps built from env. All logic is in dispatcher.ts / sender.ts,
 * which take deps as parameters so unit tests inject fakes.
 */
import type { Channel, ChannelMessage, NotificationEvent } from './events';
import { dispatchEvent } from './dispatcher';
import { sendMessage } from './sender';
import { buildDispatcherDeps, buildSenderDeps } from './factory';

/** Minimal SQS event shape (records with JSON string bodies). */
export interface SqsRecord {
  body?: string;
}
export interface SqsEvent {
  Records?: SqsRecord[];
}

function parseRecords<T>(event: SqsEvent): T[] {
  const out: T[] = [];
  for (const rec of event.Records ?? []) {
    if (typeof rec.body === 'string' && rec.body.length > 0) {
      out.push(JSON.parse(rec.body) as T);
    }
  }
  return out;
}

// ── Dispatcher (notification-events) ──────────────────────────────────────────
export const handler = async (event: SqsEvent): Promise<void> => {
  const deps = buildDispatcherDeps(process.env);
  for (const ev of parseRecords<NotificationEvent>(event)) {
    await dispatchEvent(deps, ev);
  }
};

/** Build a channel sender's Lambda handler. */
function senderHandler(channel: Channel) {
  return async (event: SqsEvent): Promise<void> => {
    const deps = buildSenderDeps(channel);
    for (const msg of parseRecords<ChannelMessage>(event)) {
      await sendMessage(deps, msg);
    }
  };
}

export const sms = { handler: senderHandler('sms') };
export const whatsapp = { handler: senderHandler('whatsapp') };
export const email = { handler: senderHandler('email') };
export const inapp = { handler: senderHandler('inapp') };
