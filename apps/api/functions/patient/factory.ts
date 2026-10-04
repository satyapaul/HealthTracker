/**
 * Build the patient domain's dependency bundle from the Lambda environment.
 *
 * The real DB adapter (RDS Proxy + node-postgres) is wired in a later infra
 * step; until then it is a clearly-marked not-wired stub so the function builds
 * and deploys. Unit tests never call this — they inject fakes directly.
 */
import { randomUUID } from 'node:crypto';
import type { PatientDeps } from './deps';
import type { DbPort, PatientRepository } from './ports/db';
import { consoleLogger } from './logger';

/** Not-wired DB port: throws if invoked. Replaced by the real adapter later. */
function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('patient DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: PatientRepository) => Promise<T>): Promise<T> {
      // The repository methods all throw; calling any of them surfaces the
      // not-wired state rather than silently succeeding.
      const repo: PatientRepository = {
        setSessionContext: async () => fail(),
        createPatient: async () => fail(),
        findPatientById: async () => fail(),
        existsByMaxId: async () => fail(),
        updatePatient: async () => fail(),
        listPatients: async () => fail(),
        listDoctorDashboard: async () => fail(),
      };
      return fn(repo);
    },
  };
}

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): PatientDeps {
  return {
    db: notWiredDb(),
    clock: { now: () => new Date() },
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
  };
}
