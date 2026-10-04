/**
 * WP 4.2 milestone + evaluator tests. All deps are injected fakes — no real
 * AWS / DB. Covers the reminder-schedule computation, doctor create, the
 * evaluator firing reminders (dedup id, mark sent, opt-out/channel skip), and
 * overdue detection.
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { MilestoneRequest, Principal } from '../http';
import { computeReminderSchedule, scheduledAtUtc, REMINDER_OFFSETS } from '../reminder-schedule';
import { createMilestone } from '../services/milestone-service';
import { evaluate } from '../services/evaluator-service';
import { makeMilestoneBundle, makeEvaluatorBundle } from './fakes';
import type { DueReminder } from '../ports';

function req(
  partial: Partial<MilestoneRequest> & Pick<MilestoneRequest, 'method' | 'path'>
): MilestoneRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, query: {}, ...partial };
}
function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string } | null;
} {
  return JSON.parse(body);
}
const doctor = (id: string): Principal => ({ userId: id, role: 'doctor', patientId: '' });

describe('reminder-schedule computation (§4.6)', () => {
  it('08:00 IST maps to 02:30 UTC on the same day for due_day', () => {
    // due_day offset 0 for 2026-08-20 -> 2026-08-20 08:00 IST == 02:30 UTC.
    expect(scheduledAtUtc('2026-08-20', 0)).toBe('2026-08-20T02:30:00.000Z');
  });

  it('builds the four reminders with the correct offsets/types', () => {
    const specs = computeReminderSchedule('2026-08-20');
    expect(specs.map((s) => s.reminderType)).toEqual([
      'advance',
      'due_day',
      'overdue',
      'final_overdue',
    ]);
    expect(specs.map((s) => s.offsetDays)).toEqual([-2, 0, 1, 3]);
    // advance is 2 days before due_day.
    expect(specs[0].scheduledAt).toBe('2026-08-18T02:30:00.000Z');
    expect(specs[2].scheduledAt).toBe('2026-08-21T02:30:00.000Z'); // overdue +1
    expect(specs[3].scheduledAt).toBe('2026-08-23T02:30:00.000Z'); // final_overdue +3
  });

  it('REMINDER_OFFSETS has four entries (M-09 one per type)', () => {
    expect(REMINDER_OFFSETS).toHaveLength(4);
  });
});

describe('POST /milestones (doctor create)', () => {
  it('creates a milestone + its four reminder rows', async () => {
    const b = makeMilestoneBundle(new Date('2026-06-01T00:00:00.000Z'));
    b.db.assign('d1', 'p1');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/milestones',
        principal: doctor('d1'),
        body: JSON.stringify({
          patientId: 'p1',
          type: 'follow_up',
          title: 'Next review',
          dueDate: '2026-08-20',
        }),
      })
    );
    expect(res.statusCode).toBe(201);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.status).toBe('scheduled');
    expect(data.reminderCount).toBe(4);
    expect(b.db.reminders).toHaveLength(4);
  });

  it('rejects a past due date', async () => {
    const b = makeMilestoneBundle(new Date('2026-06-01T00:00:00.000Z'));
    b.db.assign('d1', 'p1');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/milestones',
        principal: doctor('d1'),
        body: JSON.stringify({
          patientId: 'p1',
          type: 'follow_up',
          title: 'x',
          dueDate: '2026-05-01',
        }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('forbids a doctor not assigned to the patient', async () => {
    const b = makeMilestoneBundle(new Date('2026-06-01T00:00:00.000Z'));
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/milestones',
        principal: doctor('d1'),
        body: JSON.stringify({
          patientId: 'p1',
          type: 'follow_up',
          title: 'x',
          dueDate: '2026-08-20',
        }),
      })
    );
    expect(res.statusCode).toBe(403);
    expect(b.db.milestones.size).toBe(0);
  });

  it('createMilestone throws FORBIDDEN for a non-doctor principal', async () => {
    const b = makeMilestoneBundle();
    await expect(
      createMilestone(
        b.deps,
        { userId: 'p1', role: 'patient', patientId: 'p1' },
        {
          patientId: 'p1',
          type: 'follow_up',
          title: 'x',
          dueDate: '2026-08-20',
        }
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('milestone-evaluator (§4.6)', () => {
  function due(overrides: Partial<DueReminder> = {}): DueReminder {
    return {
      reminderId: 'r1',
      milestoneId: 'ms1',
      reminderType: 'advance',
      patientId: 'p1',
      smsEnabled: true,
      whatsappEnabled: true,
      hasPhone: true,
      hasWhatsapp: true,
      ...overrides,
    };
  }

  it('fires a due reminder to both enabled channels with {reminderId}#{channel} dedup, then marks sent', async () => {
    const b = makeEvaluatorBundle();
    b.db.due = [due()];
    const res = await evaluate(b.deps);
    expect(res.evaluated).toBe(1);
    expect(res.enqueued).toBe(2);
    const sent = b.queue.sent.sort((a, b2) => a.channel.localeCompare(b2.channel));
    expect(sent.map((s) => s.channel)).toEqual(['sms', 'whatsapp']);
    expect(sent.find((s) => s.channel === 'sms')!.dedupId).toBe('r1#sms');
    expect(sent.find((s) => s.channel === 'whatsapp')!.dedupId).toBe('r1#whatsapp');
    // Reminder marked sent exactly once (no duplicate re-pick next pass).
    expect(b.db.sent).toEqual([{ reminderId: 'r1', at: '2026-08-20T02:30:00.000Z' }]);
  });

  it('skips a channel the patient has not enabled', async () => {
    const b = makeEvaluatorBundle();
    b.db.due = [due({ whatsappEnabled: false })];
    const res = await evaluate(b.deps);
    expect(res.enqueued).toBe(1);
    expect(b.queue.sent.map((s) => s.channel)).toEqual(['sms']);
  });

  it('skips a channel with no contact number', async () => {
    const b = makeEvaluatorBundle();
    b.db.due = [due({ hasPhone: false })];
    const res = await evaluate(b.deps);
    expect(b.queue.sent.map((s) => s.channel)).toEqual(['whatsapp']);
    expect(res.enqueued).toBe(1);
  });

  it('marks a reminder sent even when no channel is enabled (not re-picked)', async () => {
    const b = makeEvaluatorBundle();
    b.db.due = [due({ smsEnabled: false, whatsappEnabled: false })];
    const res = await evaluate(b.deps);
    expect(res.enqueued).toBe(0);
    expect(b.db.sent).toHaveLength(1);
  });

  it('flags overdue milestones', async () => {
    const b = makeEvaluatorBundle();
    b.db.overdueIds = ['ms-late-1', 'ms-late-2'];
    const res = await evaluate(b.deps);
    expect(res.markedOverdue).toBe(2);
    expect(b.db.markedOverdue).toEqual(['ms-late-1', 'ms-late-2']);
  });
});
