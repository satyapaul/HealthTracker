/**
 * virus-scan Lambda entry (WP 2.4 — LLD §4.12).
 *
 * Triggered by S3 object-create events (via SNS/SQS or direct S3 notification).
 * Thin entry: build deps, extract each (bucket, objectKey) from the event,
 * delegate to the scan orchestration. All logic lives in scan-service, which
 * takes deps as parameters so unit tests inject fakes.
 *
 * NOTE: the production scanner is ClamAV in a native layer (the LLD specs a
 * Python runtime). This TypeScript handler is the orchestration; whichever
 * runtime hosts it, the clean/quarantine/error logic is identical and unit-
 * tested here. The ClamAV engine itself is a deferred infra concern.
 */
import type { VirusScanDeps } from './deps';
import { buildDeps } from './factory';
import { processObject, type ScanDisposition } from './scan-service';

/** Minimal shape of an S3 notification record (direct or SNS-wrapped). */
export interface S3EventRecord {
  s3?: {
    bucket?: { name?: string };
    object?: { key?: string };
  };
}

export interface S3Event {
  Records?: S3EventRecord[];
}

/** URL-decode an S3 key (S3 encodes spaces as '+', path parts as %XX). */
function decodeS3Key(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

function extractTargets(event: S3Event): { bucket: string; objectKey: string }[] {
  const out: { bucket: string; objectKey: string }[] = [];
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3?.bucket?.name;
    const rawKey = rec.s3?.object?.key;
    if (bucket && rawKey) {
      out.push({ bucket, objectKey: decodeS3Key(rawKey) });
    }
  }
  return out;
}

let cachedDeps: VirusScanDeps | undefined;

function getDeps(): VirusScanDeps {
  if (!cachedDeps) {
    cachedDeps = buildDeps(process.env);
  }
  return cachedDeps;
}

export const handler = async (event: S3Event): Promise<void> => {
  const deps = getDeps();
  for (const target of extractTargets(event)) {
    await processObject(deps, target);
  }
};

/** Exposed for testing the entry adapter with injected deps. */
export const handlerWithDeps = (deps: VirusScanDeps) => {
  return async (event: S3Event): Promise<ScanDisposition[]> => {
    const results: ScanDisposition[] = [];
    for (const target of extractTargets(event)) {
      results.push(await processObject(deps, target));
    }
    return results;
  };
};
