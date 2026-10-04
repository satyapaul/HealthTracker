/**
 * Dependency bundle for the followup domain. Core logic takes these as
 * parameters so unit tests inject fakes; the Lambda entry builds them from env.
 */
import type { DbPort } from './ports/db';
import type { Clock } from './ports/clock';
import type { IdGenerator } from './ports/ids';
import type { HospitalPort } from './ports/hospital';
import type { Logger } from './logger';

export interface FollowupDeps {
  db: DbPort;
  hospital: HospitalPort;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}
