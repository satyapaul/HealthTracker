/**
 * Build the virus-scan dependency bundle from the Lambda environment.
 *
 * All adapters here are clearly-marked not-wired stubs. The REAL scanner is
 * ClamAV in a native Lambda layer (LLD §4.12 — deferred to an infra WP); the
 * S3 / DB / SQS adapters are thin AWS-SDK wrappers wired in the same infra
 * step. Unit tests inject fakes directly and never call this.
 */
import type { VirusScanConfig, VirusScanDeps } from './deps';
import type { ScannerPort, S3ScanPort, ScannerDbPort, NotifierPort } from './ports';
import { consoleLogger } from './logger';

function notWiredScanner(): ScannerPort {
  return {
    async scan() {
      throw new Error('ClamAV scanner is not wired yet (infra layer)');
    },
  };
}

function notWiredS3(): S3ScanPort {
  const fail = (): never => {
    throw new Error('S3 scan adapter is not wired yet');
  };
  return {
    async copyToQuarantine() {
      fail();
    },
    async deleteObject() {
      fail();
    },
    async tag() {
      fail();
    },
  };
}

function notWiredDb(): ScannerDbPort {
  return {
    async setAttachmentScanStatus() {
      throw new Error('scanner DB adapter is not wired yet');
    },
  };
}

function notWiredNotifier(): NotifierPort {
  return {
    async attachmentQuarantined() {
      throw new Error('notifier is not wired yet');
    },
  };
}

export function buildDeps(env: NodeJS.ProcessEnv = process.env): VirusScanDeps {
  const config: VirusScanConfig = {
    labReportsBucket: env.LAB_REPORTS_BUCKET ?? '',
    chatMediaBucket: env.CHAT_MEDIA_BUCKET ?? '',
  };
  return {
    scanner: notWiredScanner(),
    s3: notWiredS3(),
    db: notWiredDb(),
    notifier: notWiredNotifier(),
    logger: consoleLogger,
    config,
  };
}
