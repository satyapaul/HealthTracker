/**
 * WP 2.4 virus-scan orchestration tests. All dependencies are injected fakes —
 * no real ClamAV / S3 / DB. Covers the DoD invariant (EICAR test file is
 * quarantined) plus the clean and scan-error paths and bucket branching.
 *
 * The fake scanner flags the EICAR standard anti-malware test signature, so no
 * real malware is involved — EICAR is a harmless, industry-standard test string.
 */
import { describe, it, expect } from 'vitest';
import { handlerWithDeps, type S3Event } from '../index';
import type { VirusScanDeps, VirusScanConfig } from '../deps';
import type { NotifierPort, S3ScanPort, ScanResult, ScannerDbPort, ScannerPort } from '../ports';

const LAB_BUCKET = 'postopcare-lab-reports-dev';
const CHAT_BUCKET = 'postopcare-chat-media-dev';

/** The EICAR test token the fake scanner treats as "infected". */
const EICAR = 'EICAR-TEST';

class FakeScanner implements ScannerPort {
  /** objectKeys that should scan as infected (contain the EICAR token). */
  constructor(
    private infected: Set<string> = new Set(),
    private errorKeys: Set<string> = new Set()
  ) {}
  async scan(_bucket: string, objectKey: string): Promise<ScanResult> {
    if (this.errorKeys.has(objectKey)) return { outcome: 'error' };
    if (this.infected.has(objectKey)) {
      return { outcome: 'infected', virusName: `${EICAR}-SIGNATURE`, fileSizeBytes: 68 };
    }
    return { outcome: 'clean', fileSizeBytes: 1024 };
  }
}

class FakeS3Scan implements S3ScanPort {
  public copied: string[] = [];
  public deleted: string[] = [];
  public tags: { bucket: string; key: string; tags: Record<string, string> }[] = [];
  async copyToQuarantine(_bucket: string, objectKey: string): Promise<void> {
    this.copied.push(objectKey);
  }
  async deleteObject(_bucket: string, objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
  }
  async tag(bucket: string, key: string, tags: Record<string, string>): Promise<void> {
    this.tags.push({ bucket, key, tags });
  }
}

class FakeScannerDb implements ScannerDbPort {
  public updates: { objectKey: string; status: string }[] = [];
  async setAttachmentScanStatus(objectKey: string, status: 'clean' | 'quarantined'): Promise<void> {
    this.updates.push({ objectKey, status });
  }
}

class FakeNotifier implements NotifierPort {
  public quarantined: string[] = [];
  async attachmentQuarantined(objectKey: string): Promise<void> {
    this.quarantined.push(objectKey);
  }
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeDeps(opts?: { infected?: string[]; errorKeys?: string[] }): {
  deps: VirusScanDeps;
  s3: FakeS3Scan;
  db: FakeScannerDb;
  notifier: FakeNotifier;
} {
  const s3 = new FakeS3Scan();
  const db = new FakeScannerDb();
  const notifier = new FakeNotifier();
  const config: VirusScanConfig = { labReportsBucket: LAB_BUCKET, chatMediaBucket: CHAT_BUCKET };
  const deps: VirusScanDeps = {
    scanner: new FakeScanner(new Set(opts?.infected ?? []), new Set(opts?.errorKeys ?? [])),
    s3,
    db,
    notifier,
    logger: noopLogger,
    config,
  };
  return { deps, s3, db, notifier };
}

function s3Event(bucket: string, key: string): S3Event {
  return { Records: [{ s3: { bucket: { name: bucket }, object: { key } } }] };
}

describe('virus-scan orchestration', () => {
  it('marks a clean lab-report attachment as clean', async () => {
    const { deps, s3, db, notifier } = makeDeps();
    const key = 'patients/p1/rows/r1/clean.pdf';
    const [disposition] = await handlerWithDeps(deps)(s3Event(LAB_BUCKET, key));

    expect(disposition).toBe('clean');
    expect(db.updates).toEqual([{ objectKey: key, status: 'clean' }]);
    expect(s3.tags).toContainEqual({ bucket: LAB_BUCKET, key, tags: { scan_result: 'clean' } });
    // Clean file is NOT deleted or quarantined.
    expect(s3.deleted).toHaveLength(0);
    expect(s3.copied).toHaveLength(0);
    expect(notifier.quarantined).toHaveLength(0);
  });

  it('QUARANTINES an EICAR test file: copies, deletes original, flips status, notifies', async () => {
    const key = 'patients/p1/rows/r1/eicar.pdf';
    const { deps, s3, db, notifier } = makeDeps({ infected: [key] });
    const [disposition] = await handlerWithDeps(deps)(s3Event(LAB_BUCKET, key));

    expect(disposition).toBe('quarantined');
    // DB flipped to quarantined.
    expect(db.updates).toEqual([{ objectKey: key, status: 'quarantined' }]);
    // Original copied to quarantine and then deleted (never servable).
    expect(s3.copied).toEqual([key]);
    expect(s3.deleted).toEqual([key]);
    // Quarantine copy tagged with the verdict.
    const infectedTag = s3.tags.find((t) => t.tags.scan_result === 'infected');
    expect(infectedTag).toBeTruthy();
    expect(infectedTag!.key).toBe(`quarantine/${key}`);
    // Admin notified.
    expect(notifier.quarantined).toEqual([key]);
  });

  it('leaves scan_status pending on a scan error (will retry)', async () => {
    const key = 'patients/p1/rows/r1/err.pdf';
    const { deps, s3, db, notifier } = makeDeps({ errorKeys: [key] });
    const [disposition] = await handlerWithDeps(deps)(s3Event(LAB_BUCKET, key));

    expect(disposition).toBe('pending');
    expect(db.updates).toHaveLength(0);
    expect(s3.deleted).toHaveLength(0);
    expect(notifier.quarantined).toHaveLength(0);
  });

  it('skips chat-media events (Phase 5) without touching the attachments table', async () => {
    const { deps, db } = makeDeps({ infected: ['chat/t1/x.jpg'] });
    const [disposition] = await handlerWithDeps(deps)(s3Event(CHAT_BUCKET, 'chat/t1/x.jpg'));
    expect(disposition).toBe('skipped');
    expect(db.updates).toHaveLength(0);
  });

  it('skips events from an unknown bucket', async () => {
    const { deps } = makeDeps();
    const [disposition] = await handlerWithDeps(deps)(s3Event('some-other-bucket', 'k'));
    expect(disposition).toBe('skipped');
  });

  it('processes every record in a multi-record event', async () => {
    const infectedKey = 'patients/p1/rows/r1/eicar.pdf';
    const cleanKey = 'patients/p1/rows/r1/ok.pdf';
    const { deps } = makeDeps({ infected: [infectedKey] });
    const event: S3Event = {
      Records: [
        { s3: { bucket: { name: LAB_BUCKET }, object: { key: cleanKey } } },
        { s3: { bucket: { name: LAB_BUCKET }, object: { key: infectedKey } } },
      ],
    };
    const dispositions = await handlerWithDeps(deps)(event);
    expect(dispositions).toEqual(['clean', 'quarantined']);
  });

  it('URL-decodes S3 object keys', async () => {
    const { deps, db } = makeDeps();
    // S3 encodes spaces as '+' in event keys.
    const event = s3Event(LAB_BUCKET, 'patients/p1/rows/r1/lab+report.pdf');
    await handlerWithDeps(deps)(event);
    expect(db.updates[0].objectKey).toBe('patients/p1/rows/r1/lab report.pdf');
  });
});
