/**
 * Dependency bundle for the hospital domain. Core logic takes these as
 * parameters so unit tests inject fakes; the Lambda entry builds them from env.
 */
import type { DbPort, HospitalSummary } from './ports/db';
import type { PickerCache } from './ports/cache';
import type { Logger } from './logger';

/** A pinned-flag picker entry (what the picker endpoint returns). */
export interface PickerEntry extends HospitalSummary {
  pinned: boolean;
}

export interface HospitalConfig {
  /** Picker cache TTL in seconds (LLD §5.3: 300). */
  pickerCacheTtlSeconds: number;
}

export interface HospitalDeps {
  db: DbPort;
  pickerCache: PickerCache<PickerEntry[]>;
  logger: Logger;
  config: HospitalConfig;
}
