/**
 * Build the admin domain's dependency bundle from the Lambda environment.
 * The real DB adapter (RDS Proxy + node-postgres) is wired in a later infra
 * step; until then it is a clearly-marked not-wired stub. Unit tests inject
 * fakes directly and never call this.
 */
import { randomUUID } from 'node:crypto';
import type { AdminConfig, AdminDeps } from './deps';
import type { AdminRepository, DbPort } from './ports/db';
import { consoleLogger } from './logger';

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('admin DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: AdminRepository) => Promise<T>): Promise<T> {
      const repo: AdminRepository = {
        setSessionContext: async () => fail(),
        getHospitalById: async () => fail(),
        getHospitalByCode: async () => fail(),
        createHospital: async () => fail(),
        updateHospital: async () => fail(),
        setHospitalStatus: async () => fail(),
        searchHospitals: async () => fail(),
        getUserRole: async () => fail(),
        findAffiliation: async () => fail(),
        getAffiliationById: async () => fail(),
        hasPrimaryAffiliation: async () => fail(),
        addAffiliation: async () => fail(),
        updateAffiliation: async () => fail(),
      };
      return fn(repo);
    },
  };
}

const DEFAULT_CONFIG: AdminConfig = {
  defaultPageSize: 25,
  maxPageSize: 100,
};

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): AdminDeps {
  return {
    db: notWiredDb(),
    clock: { now: () => new Date() },
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
    config: { ...DEFAULT_CONFIG },
  };
}
