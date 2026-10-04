/**
 * Build dependency bundles for the milestone domain (HTTP create/list) and the
 * milestone-evaluator (scheduled batch). DB adapters, SQS, and the EventBridge
 * trigger are not-wired stubs here; real adapters are deferred to infra. Unit
 * tests inject fakes directly.
 */
import { randomUUID } from 'node:crypto';
import type { MilestoneDeps, EvaluatorDeps } from './deps';
import type {
  DbPort,
  EvaluatorDbPort,
  EvaluatorDbTransactor,
  MilestoneRepository,
  ReminderQueuePort,
} from './ports';
import { consoleLogger } from './logger';

/** Asia/Kolkata is +330 minutes; India has no DST. */
const IST_OFFSET_MINUTES = 330;

function notWiredDb(): DbPort {
  const fail = (): never => {
    throw new Error('milestone DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: MilestoneRepository) => Promise<T>): Promise<T> {
      const repo: MilestoneRepository = {
        setSessionContext: async () => fail(),
        isDoctorAssignedToPatient: async () => fail(),
        createMilestone: async () => fail(),
        addReminder: async () => fail(),
        listMilestonesForPatient: async () => fail(),
      };
      return fn(repo);
    },
  };
}

function notWiredEvaluatorDb(): EvaluatorDbTransactor {
  const fail = (): never => {
    throw new Error('milestone-evaluator DB adapter is not wired yet');
  };
  return {
    async transaction<T>(fn: (repo: EvaluatorDbPort) => Promise<T>): Promise<T> {
      const repo: EvaluatorDbPort = {
        setSessionContext: async () => fail(),
        findDueReminders: async () => fail(),
        markReminderSent: async () => fail(),
        findOverdueMilestoneIds: async () => fail(),
        markMilestoneOverdue: async () => fail(),
      };
      return fn(repo);
    },
  };
}

function notWiredQueue(): ReminderQueuePort {
  return {
    async enqueue() {
      throw new Error('reminder SQS adapter is not wired yet');
    },
  };
}

export function buildMilestoneDeps(_env: NodeJS.ProcessEnv = process.env): MilestoneDeps {
  return {
    db: notWiredDb(),
    ids: { uuid: () => randomUUID() },
    clock: { now: () => new Date() },
    logger: consoleLogger,
    config: { tzOffsetMinutes: IST_OFFSET_MINUTES },
  };
}

export function buildEvaluatorDeps(_env: NodeJS.ProcessEnv = process.env): EvaluatorDeps {
  return {
    db: notWiredEvaluatorDb(),
    queue: notWiredQueue(),
    clock: { now: () => new Date() },
    logger: consoleLogger,
    config: { windowHours: 48 },
  };
}
