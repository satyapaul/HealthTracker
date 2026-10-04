/**
 * Virus-scan orchestration (WP 2.4 — LLD §4.12).
 *
 * For each uploaded object: scan, then branch:
 *   - clean      -> tag scan_result=clean; set attachments.scan_status='clean'
 *   - infected   -> copy to quarantine prefix; delete original; set
 *                   scan_status='quarantined'; tag the copy; emit
 *                   ATTACHMENT_QUARANTINED (notify admin, no PHI)
 *   - error      -> leave scan_status='pending' (will retry); surface for metric
 *
 * EICAR invariant (conventions §Testing): an EICAR test file MUST be
 * quarantined — original removed, status flipped, event emitted.
 *
 * Bucket branching: lab-reports -> attachments (this WP). chat-media ->
 * chat_attachments + message release is Phase 5 and is not handled here; such
 * events are logged and skipped.
 */
import type { VirusScanDeps } from './deps';
import type { ScanBucketKind } from './ports';

const QUARANTINE_PREFIX = 'quarantine/';

export interface ScanTarget {
  bucket: string;
  objectKey: string;
}

export type ScanDisposition = 'clean' | 'quarantined' | 'pending' | 'skipped';

function bucketKind(deps: VirusScanDeps, bucket: string): ScanBucketKind | null {
  if (bucket === deps.config.labReportsBucket) return 'lab-reports';
  if (bucket === deps.config.chatMediaBucket) return 'chat-media';
  return null;
}

/** Process one uploaded object. Returns the disposition for logging/testing. */
export async function processObject(
  deps: VirusScanDeps,
  target: ScanTarget
): Promise<ScanDisposition> {
  const { bucket, objectKey } = target;
  const kind = bucketKind(deps, bucket);

  if (kind === null) {
    deps.logger.warn('virusscan.unknown_bucket', { bucket, objectKey });
    return 'skipped';
  }

  const started = Date.now();
  const result = await deps.scanner.scan(bucket, objectKey);

  if (result.outcome === 'error') {
    // Leave pending so a later retry re-scans; emit a structured log for metrics.
    deps.logger.error('virusscan.error', { bucket, objectKey, durationMs: Date.now() - started });
    return 'pending';
  }

  if (result.outcome === 'clean') {
    await deps.s3.tag(bucket, objectKey, { scan_result: 'clean' });
    if (kind === 'lab-reports') {
      await deps.db.setAttachmentScanStatus(objectKey, 'clean');
    } else {
      // chat-media: flip the chat_attachments row AND release the held message,
      // then publish ChatMessageReceived so the now-released message is
      // delivered (HLD §4.7).
      const released = await deps.db.setChatAttachmentScanStatus(objectKey, 'clean');
      if (released) {
        await deps.notifier.chatMessageReleased(released);
      }
    }
    deps.logger.info('virusscan.clean', {
      bucket,
      objectKey,
      kind,
      fileSizeBytes: result.fileSizeBytes,
      durationMs: Date.now() - started,
    });
    return 'clean';
  }

  // infected -> quarantine. Copy to the quarantine prefix (same bucket), tag
  // the copy with the verdict, then delete the original so it can never serve.
  await deps.s3.copyToQuarantine(bucket, objectKey);
  await deps.s3.tag(bucket, `${QUARANTINE_PREFIX}${objectKey}`, {
    scan_result: 'infected',
    virus_name: result.virusName ?? 'unknown',
  });
  await deps.s3.deleteObject(bucket, objectKey);
  if (kind === 'lab-reports') {
    await deps.db.setAttachmentScanStatus(objectKey, 'quarantined');
  } else {
    // chat-media: mark the attachment quarantined; the held message is left
    // UNRELEASED (never delivered) — setChatAttachmentScanStatus returns null
    // for a quarantine and we do not publish a release event.
    await deps.db.setChatAttachmentScanStatus(objectKey, 'quarantined');
  }
  await deps.notifier.attachmentQuarantined(objectKey);

  deps.logger.warn('virusscan.quarantined', {
    bucket,
    objectKey,
    kind,
    virusName: result.virusName ?? 'unknown', // operational metadata, not PHI
    durationMs: Date.now() - started,
  });
  return 'quarantined';
}
