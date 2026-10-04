/**
 * Dependency bundles for the milestone domain (doctor create/list) and the
 * milestone-evaluator (scheduled batch).
 */
import type { DbPort, EvaluatorDbTransactor, ReminderQueuePort, IdGenerator, Clock } from './ports';
import type { Logger } from './logger';

export interface MilestoneDeps {
  db: DbPort;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
  config: {
    /** Patient timezone offset east of UTC in minutes (default +330 IST). */
    tzOffsetMinutes: number;
  };
}

export interface EvaluatorDeps {
  db: EvaluatorDbTransactor;
  queue: ReminderQueuePort;
  clock: Clock;
  logger: Logger;
  config: {
    /** Look-ahead window in hours for due reminders. */
    windowHours: number;
  };
}
