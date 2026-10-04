/**
 * Milestone evaluator (WP 4.2 — LLD §4.6). The scheduled batch job:
 *   1. Find pending reminders due within the look-ahead window (milestone still
 *      scheduled, patient not opted out).
 *   2. For each, enqueue to the patient's enabled channels (sms/whatsapp) with
 *      MessageDeduplicationId = {reminderId}#{channel}, then mark the reminder
 *      'sent'.
 *   3. Flag milestones past their due date as 'overdue'.
 *
 * The dedup id guarantees "reminders fire" without duplicates (DoD) even if the
 * evaluator runs overlapping windows. No PHI is logged or enqueued (the sender
 * resolves contact + renders the template; the evaluator passes ids only).
 */
import type { EvaluatorDeps } from '../deps';
import type { ReminderChannel } from '../ports';

export interface EvaluationResult {
  evaluated: number;
  enqueued: number;
  markedOverdue: number;
}

function dedupId(reminderId: string, channel: ReminderChannel): string {
  return `${reminderId}#${channel}`;
}

/** Run one evaluation pass. */
export async function evaluate(deps: EvaluatorDeps): Promise<EvaluationResult> {
  const now = deps.clock.now();
  const windowEnd = new Date(now.getTime() + deps.config.windowHours * 3_600_000).toISOString();
  const sentAt = now.toISOString();
  const todayIso = now.toISOString().slice(0, 10);

  const result = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext({ userId: 'system', role: 'admin', patientId: null });

    const due = await repo.findDueReminders(windowEnd);
    let enqueued = 0;

    for (const r of due) {
      const channels: ReminderChannel[] = [];
      if (r.smsEnabled && r.hasPhone) channels.push('sms');
      if (r.whatsappEnabled && r.hasWhatsapp) channels.push('whatsapp');

      for (const channel of channels) {
        await deps.queue.enqueue({
          reminderId: r.reminderId,
          milestoneId: r.milestoneId,
          patientId: r.patientId,
          reminderType: r.reminderType,
          channel,
          dedupId: dedupId(r.reminderId, channel),
        });
        enqueued += 1;
      }
      // Mark sent once dispatched (channels empty => still marked sent so the
      // evaluator does not re-pick it every pass; the patient simply has no
      // enabled push channel).
      await repo.markReminderSent(r.reminderId, sentAt);
    }

    // Overdue detection.
    const overdueIds = await repo.findOverdueMilestoneIds(todayIso);
    for (const id of overdueIds) {
      await repo.markMilestoneOverdue(id);
    }

    return { evaluated: due.length, enqueued, markedOverdue: overdueIds.length };
  });

  deps.logger.info('milestone.evaluated', {
    evaluated: result.evaluated,
    enqueued: result.enqueued,
    markedOverdue: result.markedOverdue,
  });
  return result;
}
