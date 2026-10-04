/**
 * Dependency bundle for the virus-scan orchestration. Core logic takes these as
 * parameters so unit tests inject fakes; the Lambda entry builds them from env.
 */
import type { ScannerPort, S3ScanPort, ScannerDbPort, NotifierPort } from './ports';
import type { Logger } from './logger';

export interface VirusScanConfig {
  /** Physical name of the lab-reports bucket (branches the target table). */
  labReportsBucket: string;
  /** Physical name of the chat-media bucket (Phase 5). */
  chatMediaBucket: string;
}

export interface VirusScanDeps {
  scanner: ScannerPort;
  s3: S3ScanPort;
  db: ScannerDbPort;
  notifier: NotifierPort;
  logger: Logger;
  config: VirusScanConfig;
}
