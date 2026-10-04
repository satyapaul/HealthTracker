/**
 * Build the followup domain's dependency bundle from the Lambda environment.
 *
 * The real DB adapter (RDS Proxy + node-postgres) and the hospital lookup
 * (hospitals table, Phase 3) are wired in later steps; until then they are
 * clearly-marked not-wired stubs so the function builds and deploys. Unit tests
 * never call this — they inject fakes directly.
 */
import { randomUUID } from 'node:crypto';
import type { FollowupDeps } from './deps';
import type { DbPort, FollowupRepository } from './ports/db';
import type { HospitalPort } from './ports/hospital';
import { consoleLogger } from './logger';

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('followup DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: FollowupRepository) => Promise<T>): Promise<T> {
      const repo: FollowupRepository = {
        setSessionContext: async () => fail(),
        createRow: async () => fail(),
        findRowById: async () => fail(),
        existsForDate: async () => fail(),
        updateRow: async () => fail(),
        submitRow: async () => fail(),
        listRowsForPatient: async () => fail(),
      };
      return fn(repo);
    },
  };
}

function notWiredHospital(): HospitalPort {
  return {
    async resolveForEngagement() {
      throw new Error('hospital lookup is not wired yet (Phase 3)');
    },
  };
}

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): FollowupDeps {
  return {
    db: notWiredDb(),
    hospital: notWiredHospital(),
    clock: { now: () => new Date() },
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
  };
}
