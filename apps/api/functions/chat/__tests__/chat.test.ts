/**
 * WP 5.1 chat tests. All deps are injected fakes — no real AWS / DB. Covers
 * sendMessage (membership authz, body-or-attachment, release-on-scan, push +
 * event), the read paths, and the transcript-immutability posture.
 */
import { describe, it, expect } from 'vitest';
import {
  sendMessage,
  listThreads,
  listMessages,
  postSystemCard,
  markRead,
  typing,
  type Principal,
} from '../services/chat-service';
import { makeBundle } from './fakes';

const patient = (pid: string): Principal => ({
  userId: `u-${pid}`,
  role: 'patient',
  patientId: pid,
});
const doctor = (id: string): Principal => ({ userId: id, role: 'doctor', patientId: '' });

/** Seed a care-team thread for patient p1 with members [patient, primary doctor]. */
function seedCareTeam(b: ReturnType<typeof makeBundle>): string {
  const threadId = 'thr-1';
  b.db.seedThread({
    id: threadId,
    patientId: 'p1',
    threadType: 'patient_care_team',
    memberUserIds: ['u-p1', 'd1'],
  });
  b.db.primaryDoctor.set('p1', 'd1');
  return threadId;
}

describe('sendMessage — authz + persistence', () => {
  it('a patient posts a text message to their own care-team thread', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    const res = await sendMessage(b.deps, patient('p1'), { threadId, body: 'Hello doctor' });
    expect(res.released).toBe(true);
    expect(res.messageId).toBeTruthy();
    expect(b.db.messages).toHaveLength(1);
    expect(b.db.messages[0].body).toBe('Hello doctor');
    expect(b.db.messages[0].senderRole).toBe('patient');
  });

  it('DENIES posting to a thread the caller cannot see (cross-patient)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b); // belongs to p1
    await expect(
      sendMessage(b.deps, patient('p2'), { threadId, body: 'sneaky' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(b.db.messages).toHaveLength(0);
  });

  it('the primary doctor can post to the care-team thread', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    const res = await sendMessage(b.deps, doctor('d1'), {
      threadId,
      body: 'Take the evening dose',
    });
    expect(res.released).toBe(true);
    expect(b.db.messages[0].senderRole).toBe('doctor');
  });

  it('a non-primary doctor cannot see/post to the thread', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(
      sendMessage(b.deps, doctor('other-doc'), { threadId, body: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires a body or an attachment', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(sendMessage(b.deps, patient('p1'), { threadId })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects an invalid urgency flag', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(
      sendMessage(b.deps, patient('p1'), { threadId, body: 'x', urgencyFlag: 'panic' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('forbids admins from posting chat messages', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(
      sendMessage(b.deps, { userId: 'a1', role: 'admin', patientId: '' }, { threadId, body: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('sendMessage — attachment release-on-scan', () => {
  it('holds a message whose attachment is still pending (is_released=false, not pushed)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    b.connections.connect('d1', 'conn-d1'); // doctor is online
    const res = await sendMessage(b.deps, patient('p1'), {
      threadId,
      attachment: { objectKey: 'chat/p1/x.jpg', mimeType: 'image/jpeg', scanStatus: 'pending' },
    });
    expect(res.released).toBe(false);
    expect(b.db.messages[0].isReleased).toBe(false);
    expect(b.db.attachments).toHaveLength(1);
    // Held message is NOT pushed and NOT published.
    expect(b.connections.pushes).toHaveLength(0);
    expect(b.queue.events).toHaveLength(0);
  });

  it('releases + delivers a message whose attachment is already clean', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    b.connections.connect('d1', 'conn-d1');
    const res = await sendMessage(b.deps, patient('p1'), {
      threadId,
      body: 'see attached',
      attachment: { objectKey: 'chat/p1/x.jpg', mimeType: 'image/jpeg', scanStatus: 'clean' },
    });
    expect(res.released).toBe(true);
    // Pushed to the connected doctor + ChatMessageReceived published.
    expect(b.connections.pushes).toHaveLength(1);
    expect(b.connections.pushes[0].connectionId).toBe('conn-d1');
    expect(b.queue.events).toHaveLength(1);
  });

  it('rejects a quarantined attachment (ATTACHMENT_NOT_CLEAN)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(
      sendMessage(b.deps, patient('p1'), {
        threadId,
        attachment: {
          objectKey: 'chat/p1/x.jpg',
          mimeType: 'image/jpeg',
          scanStatus: 'quarantined',
        },
      })
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_CLEAN' });
    expect(b.db.messages).toHaveLength(0);
  });
});

describe('sendMessage — delivery push (<1s synchronous path)', () => {
  it('pushes only to connected members and publishes the event for the rest', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b); // members: u-p1, d1
    b.connections.connect('d1', 'conn-d1'); // doctor online; patient (sender) excluded anyway
    const res = await sendMessage(b.deps, patient('p1'), { threadId, body: 'hi' });
    expect(res.released).toBe(true);
    // Pushed to the one connected recipient (the doctor); the sender is excluded.
    expect(b.connections.pushes.map((p) => p.connectionId)).toEqual(['conn-d1']);
    // The push frame carries ids + flag only — no body (no PHI on the wire).
    expect(b.connections.pushes[0].payload).not.toHaveProperty('body');
    // ChatMessageReceived published with the recipient list.
    expect(b.queue.events[0].recipientUserIds).toEqual(['d1']);
  });
});

describe('reads', () => {
  it('listThreads returns the patient own care-team thread', async () => {
    const b = makeBundle();
    seedCareTeam(b);
    const threads = await listThreads(b.deps, patient('p1'), 'p1');
    expect(threads).toHaveLength(1);
    expect(threads[0].threadType).toBe('patient_care_team');
  });

  it('listMessages hides unreleased messages from a patient', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    // One released + one held message.
    await sendMessage(b.deps, patient('p1'), { threadId, body: 'released' });
    await sendMessage(b.deps, patient('p1'), {
      threadId,
      attachment: { objectKey: 'chat/p1/y.jpg', mimeType: 'image/jpeg', scanStatus: 'pending' },
    });
    const msgs = await listMessages(b.deps, patient('p1'), threadId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('released');
  });

  it('listMessages denies a non-member (FORBIDDEN)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(listMessages(b.deps, patient('p2'), threadId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('postSystemCard (C-03, WP 5.2)', () => {
  it('ensures the care-team thread, appends a system card, and delivers it', async () => {
    const b = makeBundle();
    // No thread seeded — postSystemCard should create the care-team thread.
    const res = await postSystemCard(b.deps, {
      patientId: 'p1',
      text: 'Patient submitted labs for 2026-08-16 at Sanjay Gandhi Memorial Hospital',
      linkedFollowUpRowId: 'fur-1',
    });
    expect(res.messageId).toBeTruthy();
    expect(res.threadId).toBeTruthy();
    // Card persisted as a system message (NULL sender).
    const card = b.db.messages.find((m) => m.id === res.messageId)!;
    expect(card.senderRole).toBe('system');
    expect(card.senderUserId).toBeNull();
    expect(card.isReleased).toBe(true);
    expect(card.body).toContain('Sanjay Gandhi Memorial Hospital');
    // ChatMessageReceived published.
    expect(b.queue.events).toHaveLength(1);
  });

  it('reuses an existing care-team thread', async () => {
    const b = makeBundle();
    b.db.seedThread({
      id: 'thr-existing',
      patientId: 'p1',
      threadType: 'patient_care_team',
      memberUserIds: ['u-p1', 'd1'],
    });
    const res = await postSystemCard(b.deps, { patientId: 'p1', text: 'Dose updated' });
    expect(res.threadId).toBe('thr-existing');
  });

  it('pushes the card to connected members', async () => {
    const b = makeBundle();
    b.db.seedThread({
      id: 'thr-1',
      patientId: 'p1',
      threadType: 'patient_care_team',
      memberUserIds: ['u-p1', 'd1'],
    });
    b.connections.connect('d1', 'conn-d1');
    await postSystemCard(b.deps, { patientId: 'p1', text: 'Doctor updated pred dose to 5' });
    expect(b.connections.pushes.map((p) => p.connectionId)).toEqual(['conn-d1']);
    // The push frame carries ids only (the body is read under RLS).
    expect(b.connections.pushes[0].payload).not.toHaveProperty('body');
  });
});

describe('urgency triage escalation (C-07, WP 5.3 DoD)', () => {
  it('a symptom_concern message publishes ChatMessageReceived with escalate=true', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await sendMessage(b.deps, patient('p1'), {
      threadId,
      body: 'My incision is red and swollen',
      urgencyFlag: 'symptom_concern',
    });
    expect(b.queue.events).toHaveLength(1);
    expect(b.queue.events[0].urgencyFlag).toBe('symptom_concern');
    expect(b.queue.events[0].escalate).toBe(true);
  });

  it('a routine_query message does NOT escalate', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await sendMessage(b.deps, patient('p1'), { threadId, body: 'quick question' });
    expect(b.queue.events[0].escalate).toBe(false);
  });

  it('always publishes ChatMessageReceived for offline fan-out (dispatcher handles push)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await sendMessage(b.deps, patient('p1'), { threadId, body: 'hi' });
    expect(b.queue.events).toHaveLength(1);
    expect(b.queue.events[0].recipientUserIds).toEqual(['d1']);
  });
});

describe('markRead (C-05 read receipts)', () => {
  it('marks each message read and pushes receipts to connected members', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    b.connections.connect('d1', 'conn-d1');
    const res = await markRead(b.deps, patient('p1'), {
      threadId,
      messageIds: ['m1', 'm2'],
    });
    expect(res.updated).toBe(2);
    expect(b.db.reads.get('m1')?.has('u-p1')).toBe(true);
    expect(b.db.reads.get('m2')?.has('u-p1')).toBe(true);
    // Receipt pushed to the other connected member (the doctor).
    const receipt = b.connections.pushes.find((p) => p.payload.type === 'chat.read');
    expect(receipt?.connectionId).toBe('conn-d1');
    expect(receipt?.payload.readerUserId).toBe('u-p1');
  });

  it('is idempotent (re-marking the same message appends the reader once)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await markRead(b.deps, patient('p1'), { threadId, messageIds: ['m1'] });
    await markRead(b.deps, patient('p1'), { threadId, messageIds: ['m1'] });
    expect(b.db.reads.get('m1')?.size).toBe(1);
  });

  it('DENIES markRead for a non-member (FORBIDDEN)', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(
      markRead(b.deps, patient('p2'), { threadId, messageIds: ['m1'] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('typing (ephemeral)', () => {
  it('broadcasts a typing indicator to connected members with no DB write or event', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    b.connections.connect('d1', 'conn-d1');
    await typing(b.deps, patient('p1'), { threadId, isTyping: true });
    const frame = b.connections.pushes.find((p) => p.payload.type === 'chat.typing');
    expect(frame?.connectionId).toBe('conn-d1');
    expect(frame?.payload.isTyping).toBe(true);
    // No message persisted and no event published.
    expect(b.db.messages).toHaveLength(0);
    expect(b.queue.events).toHaveLength(0);
  });

  it('DENIES typing for a non-member', async () => {
    const b = makeBundle();
    const threadId = seedCareTeam(b);
    await expect(typing(b.deps, patient('p2'), { threadId, isTyping: true })).rejects.toMatchObject(
      { code: 'FORBIDDEN' }
    );
  });
});

describe('transcript immutability (C-10)', () => {
  it('the repository exposes no update/delete of messages', () => {
    const b = makeBundle();
    const repo = b.db as unknown as Record<string, unknown>;
    // The port intentionally has no updateMessage/deleteMessage surface.
    expect(repo.updateMessage).toBeUndefined();
    expect(repo.deleteMessage).toBeUndefined();
  });
});
