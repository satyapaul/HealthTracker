/**
 * Channel sender (WP 4.1 — LLD §4.8-4.11).
 *
 * One shared, idempotent sender backs all four channels (sms/whatsapp/email/
 * inapp); the only difference between channels is the injected ChannelProvider.
 *
 * Idempotent delivery (the DoD's "no duplicate sends", belt-and-suspenders to
 * SQS FIFO dedup): before calling the provider we check the delivery store by
 * messageId. If this message was already delivered, we skip the provider — so
 * even if SQS redelivers (e.g. after a visibility-timeout hiccup), the user is
 * contacted at most once.
 */
import type { SenderDeps } from './deps';
import type { ChannelMessage } from './events';

export type SendOutcome = 'sent' | 'skipped_duplicate' | 'failed';

/** Process one channel message. Returns the outcome (for tests/metrics). */
export async function sendMessage(deps: SenderDeps, message: ChannelMessage): Promise<SendOutcome> {
  // Idempotency guard: already delivered -> no-op (no duplicate send).
  if (await deps.delivery.alreadyDelivered(message.messageId)) {
    deps.logger.info('notification.send.skipped_duplicate', {
      messageId: message.messageId,
      channel: message.channel,
      notificationId: message.notificationId,
    });
    return 'skipped_duplicate';
  }

  try {
    await deps.provider.send(message);
  } catch (err) {
    // Record the failure and rethrow so SQS retries / routes to the DLQ. We do
    // NOT mark it delivered, so a retry can succeed.
    await deps.delivery.record(message.messageId, message.channel, 'failed');
    deps.logger.error('notification.send.failed', {
      messageId: message.messageId,
      channel: message.channel,
    });
    throw err;
  }

  await deps.delivery.record(message.messageId, message.channel, 'sent');
  deps.logger.info('notification.send.sent', {
    messageId: message.messageId,
    channel: message.channel,
    notificationId: message.notificationId,
  });
  return 'sent';
}
