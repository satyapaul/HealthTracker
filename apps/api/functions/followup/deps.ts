/**
 * Dependency bundle for the followup domain. Core logic takes these as
 * parameters so unit tests inject fakes; the Lambda entry builds them from env.
 */
import type { DbPort } from './ports/db';
import type { Clock } from './ports/clock';
import type { IdGenerator } from './ports/ids';
import type { HospitalPort } from './ports/hospital';
import type { S3Port, UploadIntentCache } from './ports/storage';
import type { ReminderCanceller } from './ports/reminders';
import type { Logger } from './logger';

/** Attachment-upload configuration (WP 2.4). */
export interface FollowupConfig {
  /** Allowed upload MIME types (spec §7.3 / LLD §4.3). */
  allowedMimeTypes: string[];
  /** Max upload size in bytes (20MB per LLD §4.3). */
  maxUploadBytes: number;
  /** Upload-intent cache TTL in seconds. */
  uploadIntentTtlSeconds: number;
}

export interface FollowupDeps {
  db: DbPort;
  hospital: HospitalPort;
  s3: S3Port;
  uploadIntents: UploadIntentCache;
  reminders: ReminderCanceller;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  config: FollowupConfig;
}
