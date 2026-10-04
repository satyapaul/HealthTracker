/**
 * Dependency bundle for the admin domain. Core logic takes these as parameters
 * so unit tests inject fakes; the Lambda entry builds them from env.
 */
import type { DbPort } from './ports/db';
import type { Logger } from './logger';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface AdminConfig {
  /** Default page size for hospital search; max cap applied in the service. */
  defaultPageSize: number;
  maxPageSize: number;
}

export interface AdminDeps {
  db: DbPort;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  config: AdminConfig;
}
