/**
 * Build the dose domain's dependency bundle from the Lambda environment.
 * The real DB adapter (RDS Proxy + node-postgres) is wired in a later infra
 * step; until then it is a clearly-marked not-wired stub. Unit tests inject
 * fakes directly and never call this.
 */
import { randomUUID } from 'node:crypto';
import type { DoseDeps } from './deps';
import type { DbPort, DoseRepository } from './ports/db';
import type { SystemCardPoster } from './ports/system-card';
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

/** System-card poster: real adapter (infra) delegates to the chat domain. */
function noopSystemCardPoster(): SystemCardPoster {
  return {
    async postDoseChanges() {
      /* no-op until the chat adapter is wired */
    },
  };
}

export function buildDeps(_env: NodeJS.ProcessEnv = process.env): DoseDeps {
  return {
    db: notWiredDb(),
    systemCards: noopSystemCardPoster(),
    clock: { now: () => new Date() },
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
  };
}
