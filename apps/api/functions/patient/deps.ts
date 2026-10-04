/**
 * Dependency bundle for the patient domain. Core logic takes these as
 * parameters so unit tests inject fakes; the Lambda entry (index.ts) builds
 * them from env.
 */
import type { DbPort } from './ports/db';
import type { Clock } from './ports/clock';
import type { IdGenerator } from './ports/ids';
import type { Logger } from './logger';

export interface PatientDeps {
  db: DbPort;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}
