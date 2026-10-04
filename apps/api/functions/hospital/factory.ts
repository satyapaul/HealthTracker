/**
 * Build the hospital domain's dependency bundle from the Lambda environment.
 * The DB adapter (RDS Proxy + node-postgres) and the Redis picker cache are
 * wired in a later infra step; until then the DB is a not-wired stub and the
 * cache is a no-op (always miss). Unit tests inject fakes directly.
 */
import type { HospitalConfig, HospitalDeps, PickerEntry } from './deps';
import type { DbPort, HospitalRepository } from './ports/db';
import type { PickerCache } from './ports/cache';
import { consoleLogger } from './logger';

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('hospital DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: HospitalRepository) => Promise<T>): Promise<T> {
      const repo: HospitalRepository = {
        setSessionContext: async () => fail(),
        getVirtualHospital: async () => fail(),
        getHospitalById: async () => fail(),
        listActiveAffiliatedHospitals: async () => fail(),
        getPrimaryDoctorId: async () => fail(),
        isDoctorAssignedToPatient: async () => fail(),
        listDoctorAffiliations: async () => fail(),
      };
      return fn(repo);
    },
  };
}

/** No-op cache: always a miss, writes discarded. Real Redis adapter is infra. */
function noopCache(): PickerCache<PickerEntry[]> {
  return {
    async get() {
      return null;
    },
    async set() {
      /* no-op */
    },
  };
}

const DEFAULT_CONFIG: HospitalConfig = {
  pickerCacheTtlSeconds: 300,
};

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): HospitalDeps {
  return {
    db: notWiredDb(),
    pickerCache: noopCache(),
    logger: consoleLogger,
    config: { ...DEFAULT_CONFIG },
  };
}
