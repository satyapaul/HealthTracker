/**
 * Build the dose domain's dependency bundle from the Lambda environment.
 * The real DB adapter (RDS Proxy + node-postgres) is wired in a later infra
 * step; until then it is a clearly-marked not-wired stub. Unit tests inject
 * fakes directly and never call this.
 */
import { randomUUID } from 'node:crypto';
import type { DoseDeps } from './deps';
import type { DbPort, DoseRepository } from './ports/db';
import { consoleLogger } from './logger';

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('dose DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: DoseRepository) => Promise<T>): Promise<T> {
      const repo: DoseRepository = {
        setSessionContext: async () => fail(),
        findRowForReview: async () => fail(),
        responseExists: async () => fail(),
        insertDoseChange: async () => fail(),
        markReviewed: async () => fail(),
        insertResponse: async () => fail(),
        listDoseChanges: async () => fail(),
        findResponse: async () => fail(),
      };
      return fn(repo);
    },
  };
}

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): DoseDeps {
  return {
    db: notWiredDb(),
    clock: { now: () => new Date() },
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
  };
}
