/**
 * WP 4.1 notification dispatcher + sender tests. All deps are injected fakes —
 * no real SQS / SES / DynamoDB. Covers event routing, the FIFO dedup id, PHI-
 * free payloads, in-app rows, and the DoD: no duplicate sends (dedup at enqueue
 * + idempotent delivery at the sender).
 */
import { describe, it, expect } from 'vitest';
import { dispatchEvent } from '../dispatcher';
import { sendMessage } from '../sender';
import { dedupIdFor } from '../events';
import type { NotificationEvent, ChannelMessage } from '../events';
import { makeDispatcherBundle, makeSenderBundle } from './fakes';

function event(
  partial: Partial<NotificationEvent> & Pick<NotificationEvent, 'eventType'>
): NotificationEvent {
  return {
    eventId: 'evt-1',
    patientId: 'p1',
    payload: {},
    ...partial,
  };
}

describe('dispatcher — routing + in-app rows', () => {
  it('FOLLOWUP_SUBMITTED fans out to the care team enabled channels (inapp+email)', async () => {
    const b = makeDispatcherBundle();
    b.db.targetsByEvent.set('FOLLOWUP_SUBMITTED', [
      { userId: 'doc1', enabledChannels: ['inapp', 'email', 'sms'] },
    ]);

    const res = await dispatchEvent(
      b.deps,
      event({ eventType: 'FOLLOWUP_SUBMITTED', payload: { rowId: 'r1' } })
    );

    // One in-app row created for the target.
    expect(res.notificationsCreated).toBe(1);
    expect(b.db.inserted).toHaveLength(1);
    // FOLLOWUP_SUBMITTED allows inapp+email only (not sms), and the user has
    // inapp+email+sms enabled -> intersection is inapp+email.
    const channels = b.queue.sent.map((s) => s.message.channel).sort();
    expect(channels).toEqual(['email', 'inapp']);
  });

  it('DOCTOR_RESPONDED to the patient uses all enabled channels incl. sms/whatsapp', async () => {
    const b = makeDispatcherBundle();
    b.db.targetsByEvent.set('DOCTOR_RESPONDED', [
      { userId: 'pu1', enabledChannels: ['inapp', 'email', 'sms', 'whatsapp'] },
    ]);
    const res = await dispatchEvent(
      b.deps,
      event({ eventType: 'DOCTOR_RESPONDED', payload: { rowId: 'r1' } })
    );
    expect(res.enqueued).toBe(4);
    const channels = b.queue.sent.map((s) => s.message.channel).sort();
    expect(channels).toEqual(['email', 'inapp', 'sms', 'whatsapp']);
  });

  it('skips channels the user has not enabled', async () => {
    const b = makeDispatcherBundle();
    b.db.targetsByEvent.set('DOCTOR_RESPONDED', [
      { userId: 'pu1', enabledChannels: ['inapp'] }, // only in-app
    ]);
    await dispatchEvent(b.deps, event({ eventType: 'DOCTOR_RESPONDED' }));
    expect(b.queue.sent.map((s) => s.message.channel)).toEqual(['inapp']);
  });

  it('sets MessageDeduplicationId = {notificationId}#{channel} and a per-user group id', async () => {
    const b = makeDispatcherBundle();
    b.db.targetsByEvent.set('DOCTOR_RESPONDED', [{ userId: 'pu1', enabledChannels: ['email'] }]);
    await dispatchEvent(b.deps, event({ eventType: 'DOCTOR_RESPONDED' }));
    const { message, fifo } = b.queue.sent[0];
    expect(fifo.dedupId).toBe(dedupIdFor(message.notificationId, 'email'));
    expect(fifo.groupId).toBe('email:pu1');
  });

  it('puts NO PHI in the in-app payload or channel params (deep link + ids only)', async () => {
    const b = makeDispatcherBundle();
    b.db.targetsByEvent.set('DOCTOR_RESPONDED', [{ userId: 'pu1', enabledChannels: ['email'] }]);
    await dispatchEvent(
      b.deps,
      event({
        eventType: 'DOCTOR_RESPONDED',
        payload: { rowId: 'r1', doctorName: 'Dr X', labValue: 10 },
      })
    );
    // In-app payload only carries ids + deep link, not doctorName/labValue.
    const payload = b.db.inserted[0].payload;
    expect(payload).toHaveProperty('deepLink');
    expect(payload).toHaveProperty('patientId', 'p1');
    expect(payload).not.toHaveProperty('doctorName');
    expect(payload).not.toHaveProperty('labValue');
    // Channel params: deep link + app name only.
    const params = b.queue.sent[0].message.templateParams;
    expect(Object.keys(params).sort()).toEqual(['appName', 'deepLink']);
  });

  it('fans out to multiple target users', async () => {
    const b = makeDispatcherBundle();
    b.db.targetsByEvent.set('FOLLOWUP_SUBMITTED', [
      { userId: 'doc1', enabledChannels: ['inapp'] },
      { userId: 'doc2', enabledChannels: ['inapp'] },
    ]);
    const res = await dispatchEvent(b.deps, event({ eventType: 'FOLLOWUP_SUBMITTED' }));
    expect(res.notificationsCreated).toBe(2);
    expect(b.queue.sent).toHaveLength(2);
  });
});

describe('sender — idempotent delivery (DoD: no duplicate sends)', () => {
  function msg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
    return {
      messageId: 'm1',
      channel: 'email',
      notificationId: 'n1',
      userId: 'u1',
      patientId: 'p1',
      eventType: 'DOCTOR_RESPONDED',
      template: 'doctor_responded__email',
      templateParams: { deepLink: 'https://app/x', appName: 'PostOp Care' },
      enqueuedAt: '2026-08-16T10:42:00.000Z',
      ...overrides,
    };
  }

  it('sends once and records the receipt', async () => {
    const b = makeSenderBundle();
    const outcome = await sendMessage(b.deps, msg());
    expect(outcome).toBe('sent');
    expect(b.provider.sent).toHaveLength(1);
    expect(b.delivery.records.get('m1')?.status).toBe('sent');
  });

  it('does NOT re-send a message already delivered (redelivery is a no-op)', async () => {
    const b = makeSenderBundle();
    await sendMessage(b.deps, msg()); // first delivery
    const outcome = await sendMessage(b.deps, msg()); // SQS redelivers same messageId
    expect(outcome).toBe('skipped_duplicate');
    // Provider was called exactly once across both deliveries.
    expect(b.provider.sent).toHaveLength(1);
  });

  it('a provider failure is recorded and rethrown, leaving the message retryable', async () => {
    const b = makeSenderBundle();
    b.provider.failTimes = 1;
    await expect(sendMessage(b.deps, msg())).rejects.toThrow();
    // Not marked 'sent', so a retry can proceed.
    expect(b.delivery.records.get('m1')?.status).toBe('failed');
    expect(await b.delivery.alreadyDelivered('m1')).toBe(false);

    // Retry succeeds and sends exactly once.
    const outcome = await sendMessage(b.deps, msg());
    expect(outcome).toBe('sent');
    expect(b.provider.sent).toHaveLength(1);
  });

  it('distinct messages are each delivered (dedup is per messageId)', async () => {
    const b = makeSenderBundle();
    await sendMessage(b.deps, msg({ messageId: 'm1' }));
    await sendMessage(b.deps, msg({ messageId: 'm2' }));
    expect(b.provider.sent).toHaveLength(2);
  });
});
