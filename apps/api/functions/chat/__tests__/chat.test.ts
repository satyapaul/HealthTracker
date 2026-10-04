/**
 * WP 5.1 chat tests. All deps are injected fakes — no real AWS / DB. Covers
 * sendMessage (membership authz, body-or-attachment, release-on-scan, push +
 * event), the read paths, and the transcript-immutability posture.
 */
import { describe, it, expect } from 'vitest';
import { sendMessage, listThreads, listMessages, type Principal } from '../services/chat-service';
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

describe('transcript immutability (C-10)', () => {
  it('the repository exposes no update/delete of messages', () => {
    const b = makeBundle();
    const repo = b.db as unknown as Record<string, unknown>;
    // The port intentionally has no updateMessage/deleteMessage surface.
    expect(repo.updateMessage).toBeUndefined();
    expect(repo.deleteMessage).toBeUndefined();
  });
});
