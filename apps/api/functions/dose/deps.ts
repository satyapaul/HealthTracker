/**
 * Dependency bundle for the dose domain. Core logic takes these as parameters
 * so unit tests inject fakes; the Lambda entry builds them from env.
 */
import type { DbPort } from './ports/db';
import type { Clock } from './ports/clock';
import type { IdGenerator } from './ports/ids';
import type { SystemCardPoster } from './ports/system-card';
import type { Logger } from './logger';

export interface DoseDeps {
  db: DbPort;
  systemCards: SystemCardPoster;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}
