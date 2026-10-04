/**
 * In-memory fakes for the milestone domain + evaluator ports. No real IO.
 */
import type { MilestoneDeps, EvaluatorDeps } from '../deps';
import type {
  DbPort,
  DueReminder,
  EvaluatorDbPort,
  EvaluatorDbTransactor,
  MilestoneRecord,
  MilestoneRepository,
  NewMilestoneInput,
  NewReminderInput,
  ReminderChannel,
  ReminderScheduleRecord,
  SessionContext,
} from '../ports';
import type { ReminderType } from '../reminder-schedule';
import type { Logger } from '../logger';

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export class FakeIds {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
}

/** Milestone repo fake: assignments + captured milestone/reminder inserts. */
export class FakeMilestoneDb implements DbPort, MilestoneRepository {
  public assignments = new Set<string>(); // `${doctorId}:${patientId}`
  public milestones = new Map<string, MilestoneRecord>();
  public reminders: ReminderScheduleRecord[] = [];

  assign(doctorId: string, patientId: string): void {
    this.assignments.add(`${doctorId}:${patientId}`);
  }

  async transaction<T>(fn: (repo: MilestoneRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async setSessionContext(_ctx: SessionContext): Promise<void> {
    /* no-op in the fake */
  }
  async isDoctorAssignedToPatient(doctorId: string, patientId: string): Promise<boolean> {
    return this.assignments.has(`${doctorId}:${patientId}`);
  }
  async createMilestone(input: NewMilestoneInput): Promise<MilestoneRecord> {
    const rec: MilestoneRecord = {
      id: input.id,
      patientId: input.patientId,
      type: input.type,
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      status: 'scheduled',
      source: input.source,
      linkedFollowUpRowId: null,
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    this.milestones.set(rec.id, rec);
    return { ...rec };
  }
  async addReminder(input: NewReminderInput): Promise<void> {
    this.reminders.push({
      id: input.id,
      milestoneId: input.milestoneId,
      reminderType: input.reminderType,
      offsetDays: input.offsetDays,
      scheduledAt: input.scheduledAt,
      status: 'pending',
    });
  }
  async listMilestonesForPatient(patientId: string): Promise<MilestoneRecord[]> {
    return [...this.milestones.values()]
      .filter((m) => m.patientId === patientId)
      .map((m) => ({ ...m }));
  }
}

export function makeMilestoneBundle(now?: Date): {
  deps: MilestoneDeps;
  db: FakeMilestoneDb;
} {
  const db = new FakeMilestoneDb();
  const deps: MilestoneDeps = {
    db,
    ids: new FakeIds(),
    clock: new FixedClock(now ?? new Date('2026-06-01T00:00:00.000Z')),
    logger: noopLogger,
    config: { tzOffsetMinutes: 330 },
  };
  return { deps, db };
}

// ── Evaluator fakes ───────────────────────────────────────────────────────────

export class FakeEvaluatorDb implements EvaluatorDbTransactor, EvaluatorDbPort {
  public due: DueReminder[] = [];
  public sent: { reminderId: string; at: string }[] = [];
  public overdueIds: string[] = [];
  public markedOverdue: string[] = [];

  async transaction<T>(fn: (repo: EvaluatorDbPort) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async setSessionContext(_ctx: SessionContext): Promise<void> {
    /* no-op */
  }
  async findDueReminders(_windowEndIso: string): Promise<DueReminder[]> {
    return this.due.map((d) => ({ ...d }));
  }
  async markReminderSent(reminderId: string, sentAtIso: string): Promise<void> {
    this.sent.push({ reminderId, at: sentAtIso });
  }
  async findOverdueMilestoneIds(_todayIso: string): Promise<string[]> {
    return [...this.overdueIds];
  }
  async markMilestoneOverdue(milestoneId: string): Promise<void> {
    this.markedOverdue.push(milestoneId);
  }
}

export class FakeReminderQueue {
  public sent: {
    reminderId: string;
    channel: ReminderChannel;
    dedupId: string;
    reminderType: ReminderType;
  }[] = [];
  async enqueue(input: {
    reminderId: string;
    milestoneId: string;
    patientId: string;
    reminderType: ReminderType;
    channel: ReminderChannel;
    dedupId: string;
  }): Promise<void> {
    this.sent.push({
      reminderId: input.reminderId,
      channel: input.channel,
      dedupId: input.dedupId,
      reminderType: input.reminderType,
    });
  }
}

export function makeEvaluatorBundle(now?: Date): {
  deps: EvaluatorDeps;
  db: FakeEvaluatorDb;
  queue: FakeReminderQueue;
} {
  const db = new FakeEvaluatorDb();
  const queue = new FakeReminderQueue();
  const deps: EvaluatorDeps = {
    db,
    queue,
    clock: new FixedClock(now ?? new Date('2026-08-20T02:30:00.000Z')),
    logger: noopLogger,
    config: { windowHours: 48 },
  };
  return { deps, db, queue };
}
