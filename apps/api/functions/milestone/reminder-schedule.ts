/**
 * Reminder-schedule computation (WP 4.2 — LLD §4.6). Pure + deterministic.
 *
 * For a milestone due on `dueDate`, four reminders are scheduled relative to it,
 * each at 08:00 in the patient timezone (default Asia/Kolkata, UTC+5:30):
 *   advance        due_date - 2 days   @ 08:00
 *   due_day        due_date + 0 days   @ 08:00
 *   overdue        due_date + 1 day    @ 08:00
 *   final_overdue  due_date + 3 days   @ 08:00
 *
 * The uq_reminder_milestone_type DB constraint guarantees at most one reminder
 * of each type per milestone (M-09 "no duplicates").
 */

export type ReminderType = 'advance' | 'due_day' | 'overdue' | 'final_overdue';

export interface ReminderSpec {
  reminderType: ReminderType;
  offsetDays: number;
  /** ISO-8601 UTC instant for 08:00 patient-local on due_date + offset. */
  scheduledAt: string;
}

/** The fixed cadence (offset in days from due_date). */
export const REMINDER_OFFSETS: { reminderType: ReminderType; offsetDays: number }[] = [
  { reminderType: 'advance', offsetDays: -2 },
  { reminderType: 'due_day', offsetDays: 0 },
  { reminderType: 'overdue', offsetDays: 1 },
  { reminderType: 'final_overdue', offsetDays: 3 },
];

/** Minutes offset for a fixed-offset timezone (default Asia/Kolkata = +330). */
const DEFAULT_TZ_OFFSET_MINUTES = 330;
const REMINDER_LOCAL_HOUR = 8;

/**
 * Compute the UTC instant for 08:00 patient-local on (dueDate + offsetDays).
 * `dueDate` is an ISO date (YYYY-MM-DD). `tzOffsetMinutes` is the patient
 * timezone's fixed offset east of UTC (India has no DST, so a fixed offset is
 * exact; a full tz database is a later refinement if other zones are added).
 */
export function scheduledAtUtc(
  dueDate: string,
  offsetDays: number,
  tzOffsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES
): string {
  const [y, m, d] = dueDate.split('-').map((n) => Number(n));
  // 08:00 local == (08:00 - tzOffset) UTC. Build from the UTC epoch for the
  // date at midnight UTC, add the day offset, then set the local-8am instant.
  const baseUtcMidnight = Date.UTC(y, m - 1, d);
  const dayMs = 86_400_000;
  const localEightMs =
    baseUtcMidnight +
    offsetDays * dayMs +
    REMINDER_LOCAL_HOUR * 3_600_000 -
    tzOffsetMinutes * 60_000;
  return new Date(localEightMs).toISOString();
}

/** Build the four reminder specs for a milestone due on `dueDate`. */
export function computeReminderSchedule(
  dueDate: string,
  tzOffsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES
): ReminderSpec[] {
  return REMINDER_OFFSETS.map(({ reminderType, offsetDays }) => ({
    reminderType,
    offsetDays,
    scheduledAt: scheduledAtUtc(dueDate, offsetDays, tzOffsetMinutes),
  }));
}
