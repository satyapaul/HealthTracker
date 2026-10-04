/**
 * Build the followup domain's dependency bundle from the Lambda environment.
 *
 * The real DB adapter (RDS Proxy + node-postgres), the hospital lookup
 * (hospitals table, Phase 3), and the S3 + Redis upload-intent adapters are
 * wired in later infra steps; until then they are clearly-marked not-wired
 * stubs so the function builds and deploys. Unit tests never call this — they
 * inject fakes directly.
 */
import { randomUUID } from 'node:crypto';
import type { FollowupConfig, FollowupDeps } from './deps';
import type { AttachmentRepository, DbPort, FollowupRepository } from './ports/db';
import type { HospitalLookup } from './ports/hospital';
import { DbHospitalPort } from './ports/hospital';
import type { S3Port, UploadIntentCache } from './ports/storage';
import { consoleLogger } from './logger';

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('followup DB adapter is not wired yet');
  };
  return {
    async transaction<T>(
      fn: (repo: FollowupRepository & AttachmentRepository) => Promise<T>
    ): Promise<T> {
      const repo: FollowupRepository & AttachmentRepository = {
        setSessionContext: async () => fail(),
        createRow: async () => fail(),
        findRowById: async () => fail(),
        existsForDate: async () => fail(),
        updateRow: async () => fail(),
        submitRow: async () => fail(),
        listRowsForPatient: async () => fail(),
        insertAttachment: async () => fail(),
        listAttachments: async () => fail(),
      };
      return fn(repo);
    },
  };
}

/**
 * HospitalLookup backed by the DB (WP 3.1). The concrete queries live in a thin
 * adapter wired alongside the DB adapter in the infra step; until then this is
 * a not-wired stub. The engagement-authorization RULE (Virtual-or-affiliation)
 * is in DbHospitalPort and is fully unit-tested with a fake lookup.
 */
function notWiredHospitalLookup(): HospitalLookup {
  const fail = (): never => {
    throw new Error('hospital lookup adapter is not wired yet');
  };
  return {
    async getHospital() {
      return fail();
    },
    async getPrimaryDoctorId() {
      return fail();
    },
    async hasActiveAffiliation() {
      return fail();
    },
  };
}

function notWiredS3(): S3Port {
  return {
    async presignPut() {
      throw new Error('S3 adapter is not wired yet');
    },
    async objectExists() {
      throw new Error('S3 adapter is not wired yet');
    },
  };
}

function notWiredUploadIntents(): UploadIntentCache {
  return {
    async put() {
      throw new Error('upload-intent cache is not wired yet');
    },
    async get() {
      throw new Error('upload-intent cache is not wired yet');
    },
    async del() {
      throw new Error('upload-intent cache is not wired yet');
    },
  };
}

const DEFAULT_CONFIG: FollowupConfig = {
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  maxUploadBytes: 20 * 1024 * 1024, // 20MB (LLD §4.3)
  uploadIntentTtlSeconds: 1800,
};

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): FollowupDeps {
  return {
    db: notWiredDb(),
    hospital: new DbHospitalPort(notWiredHospitalLookup()),
    s3: notWiredS3(),
    uploadIntents: notWiredUploadIntents(),
    clock: { now: () => new Date() },
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
    config: { ...DEFAULT_CONFIG },
  };
}
