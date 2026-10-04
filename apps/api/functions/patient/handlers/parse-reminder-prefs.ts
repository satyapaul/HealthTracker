/**
 * Parse the optional reminderPreferences object from a request body into a
 * typed ReminderPreferences, or undefined if absent. Validates shape so a
 * malformed value is a clean VALIDATION_ERROR rather than a 500.
 */
import { AppError } from '../envelope';
import type { ReminderPreferences } from '../ports/db';

export function parseReminderPreferences(raw: unknown): ReminderPreferences | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('VALIDATION_ERROR', "Field 'reminderPreferences' must be an object", {
      field: 'reminderPreferences',
    });
  }
  const obj = raw as Record<string, unknown>;
  const smsEnabled = obj.smsEnabled;
  const whatsappEnabled = obj.whatsappEnabled;
  const timezone = obj.timezone;

  if (
    typeof smsEnabled !== 'boolean' ||
    typeof whatsappEnabled !== 'boolean' ||
    typeof timezone !== 'string' ||
    timezone.trim() === ''
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      "Field 'reminderPreferences' must have boolean smsEnabled/whatsappEnabled and a timezone string",
      { field: 'reminderPreferences' }
    );
  }

  return { smsEnabled, whatsappEnabled, timezone: timezone.trim() };
}
