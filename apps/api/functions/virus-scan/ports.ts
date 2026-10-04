/**
 * Ports for the virus-scan orchestration (WP 2.4 — LLD §4.12).
 *
 * The orchestration (parse event -> scan -> clean/quarantine/error branches ->
 * S3 + DB side-effects) is implemented in TypeScript and unit-tested with fakes.
 *
 * DEFERRED to infra / live verification (Decision 1): the REAL scanner is
 * ClamAV in a native Lambda layer (the LLD specs a Python runtime). Here the
 * ScannerPort abstracts "scan these bytes"; the production adapter shells out to
 * ClamAV. Tests inject a fake that flags the EICAR test signature.
 */

export type ScanOutcome = 'clean' | 'infected' | 'error';

export interface ScanResult {
  outcome: ScanOutcome;
  /** Present when outcome === 'infected'. */
  virusName?: string;
  /** Object size in bytes (for the structured log), when known. */
  fileSizeBytes?: number;
}

/** Which logical bucket an event came from (drives the target table). */
export type ScanBucketKind = 'lab-reports' | 'chat-media';

/** Scans an object already identified by bucket + key. */
export interface ScannerPort {
  scan(bucket: string, objectKey: string): Promise<ScanResult>;
}

/**
 * S3 side-effect operations the scanner performs. Copy-to-quarantine then
 * delete-original on an infected file; tagging records the scan verdict.
 */
export interface S3ScanPort {
  copyToQuarantine(bucket: string, objectKey: string): Promise<void>;
  deleteObject(bucket: string, objectKey: string): Promise<void>;
  tag(bucket: string, objectKey: string, tags: Record<string, string>): Promise<void>;
}

/**
 * Scanner DB writes. Per LLD §2.3 the scanner runs under a SCOPED SERVICE ROLE
 * (not postopcare_app) and updates by object_key, OUTSIDE the RLS-bound app
 * context — so this port is deliberately separate from the app's DbPort and
 * takes no session/RLS context.
 */
export interface ScannerDbPort {
  /** Flip the attachments row for this object_key to clean | quarantined. */
  setAttachmentScanStatus(objectKey: string, status: 'clean' | 'quarantined'): Promise<void>;
}

/** Emits the ATTACHMENT_QUARANTINED event (notification-dispatcher SQS). */
export interface NotifierPort {
  attachmentQuarantined(objectKey: string): Promise<void>;
}
