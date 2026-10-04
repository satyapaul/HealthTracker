/**
 * In-memory fakes for the chat ports. No real IO. The FakeDb honors the chat
 * RLS visibility (patient -> own care_team thread; doctor -> primary_doctor_id
 * threads; admin -> all) and the append-only message store.
 */
import type { ChatDeps } from '../deps';
import type {
  ChatEventQueue,
  ChatRepository,
  ConnectionPush,
  DbPort,
  MessageRecord,
  NewAttachmentInput,
  NewMessageInput,
  SessionContext,
  ThreadRecord,
  UrgencyFlag,
} from '../ports';
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

export interface SeedThread {
  id: string;
  patientId: string;
  threadType: 'patient_care_team' | 'doctor_internal_consult';
  /** care-team membership for push fan-out (user ids). */
  memberUserIds: string[];
}

export class FakeDb implements DbPort, ChatRepository {
  public threads = new Map<string, ThreadRecord>();
  public threadMembers = new Map<string, string[]>();
  public messages: MessageRecord[] = [];
  public attachments: NewAttachmentInput[] = [];
  /** patientId -> primary doctor id (for doctor thread visibility). */
  public primaryDoctor = new Map<string, string>();
  private ctx: SessionContext | null = null;

  constructor(private clock: FixedClock) {}

  seedThread(t: SeedThread): void {
    this.threads.set(t.id, {
      id: t.id,
      patientId: t.patientId,
      threadType: t.threadType,
      createdAt: this.clock.now().toISOString(),
    });
    this.threadMembers.set(t.id, t.memberUserIds);
  }

  async transaction<T>(fn: (repo: ChatRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async setSessionContext(ctx: SessionContext): Promise<void> {
    this.ctx = ctx;
  }

  /** Mirror the V11 RLS visibility for a thread. */
  private canSee(t: ThreadRecord): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.role === 'admin') return true;
    if (ctx.role === 'patient' || ctx.role === 'caregiver') {
      return (
        t.threadType === 'patient_care_team' && !!ctx.patientId && t.patientId === ctx.patientId
      );
    }
    if (ctx.role === 'doctor') {
      return this.primaryDoctor.get(t.patientId) === ctx.userId;
    }
    return false;
  }

  async findThreadById(threadId: string): Promise<ThreadRecord | null> {
    const t = this.threads.get(threadId);
    if (!t || !this.canSee(t)) return null;
    return { ...t };
  }
  async listThreads(patientId: string): Promise<ThreadRecord[]> {
    return [...this.threads.values()]
      .filter((t) => t.patientId === patientId && this.canSee(t))
      .map((t) => ({ ...t }));
  }
  async listMessages(threadId: string): Promise<MessageRecord[]> {
    const ctx = this.ctx;
    return (
      this.messages
        .filter((m) => m.threadId === threadId)
        // patient/caregiver see released only; doctor/admin see all.
        .filter((m) =>
          ctx && (ctx.role === 'patient' || ctx.role === 'caregiver') ? m.isReleased : true
        )
        .map((m) => ({ ...m }))
    );
  }
  async insertMessage(input: NewMessageInput): Promise<MessageRecord> {
    const rec: MessageRecord = {
      id: input.id,
      threadId: input.threadId,
      senderUserId: input.senderUserId,
      senderRole: input.senderRole,
      body: input.body,
      urgencyFlag: input.urgencyFlag,
      linkedFollowUpRowId: input.linkedFollowUpRowId,
      isReleased: input.isReleased,
      createdAt: this.clock.now().toISOString(),
    };
    this.messages.push(rec);
    return { ...rec };
  }
  async insertAttachment(input: NewAttachmentInput): Promise<void> {
    this.attachments.push(input);
  }
  async threadMemberUserIds(threadId: string, exceptUserId: string): Promise<string[]> {
    return (this.threadMembers.get(threadId) ?? []).filter((u) => u !== exceptUserId);
  }

  // ── System cards (WP 5.2) ────────────────────────────────────────────────
  async ensureCareTeamThread(patientId: string, newThreadId: string): Promise<string> {
    for (const t of this.threads.values()) {
      if (t.patientId === patientId && t.threadType === 'patient_care_team') return t.id;
    }
    this.threads.set(newThreadId, {
      id: newThreadId,
      patientId,
      threadType: 'patient_care_team',
      createdAt: this.clock.now().toISOString(),
    });
    this.threadMembers.set(newThreadId, []);
    return newThreadId;
  }

  async insertSystemCard(input: {
    id: string;
    threadId: string;
    body: string;
    linkedFollowUpRowId: string | null;
  }): Promise<MessageRecord> {
    const rec: MessageRecord = {
      id: input.id,
      threadId: input.threadId,
      senderUserId: null,
      senderRole: 'system',
      body: input.body,
      urgencyFlag: 'routine_query',
      linkedFollowUpRowId: input.linkedFollowUpRowId,
      isReleased: true,
      createdAt: this.clock.now().toISOString(),
    };
    this.messages.push(rec);
    return { ...rec };
  }

  async threadAllMemberUserIds(threadId: string): Promise<string[]> {
    return [...(this.threadMembers.get(threadId) ?? [])];
  }
}

/** Records pushes; a user is "connected" if added via connect(). */
export class FakeConnections implements ConnectionPush {
  public connected = new Map<string, string>(); // userId -> connectionId
  public pushes: { connectionId: string; payload: Record<string, unknown> }[] = [];
  connect(userId: string, connectionId: string): void {
    this.connected.set(userId, connectionId);
  }
  async connectionFor(userId: string): Promise<string | null> {
    return this.connected.get(userId) ?? null;
  }
  async push(connectionId: string, payload: Record<string, unknown>): Promise<boolean> {
    this.pushes.push({ connectionId, payload });
    return true;
  }
}

export class FakeQueue implements ChatEventQueue {
  public events: {
    threadId: string;
    messageId: string;
    urgencyFlag: UrgencyFlag;
    recipientUserIds: string[];
  }[] = [];
  async chatMessageReceived(input: {
    threadId: string;
    messageId: string;
    patientId: string;
    urgencyFlag: UrgencyFlag;
    recipientUserIds: string[];
  }): Promise<void> {
    this.events.push({
      threadId: input.threadId,
      messageId: input.messageId,
      urgencyFlag: input.urgencyFlag,
      recipientUserIds: input.recipientUserIds,
    });
  }
}

export interface FakeBundle {
  deps: ChatDeps;
  db: FakeDb;
  connections: FakeConnections;
  queue: FakeQueue;
}

export function makeBundle(now?: Date): FakeBundle {
  const clock = new FixedClock(now ?? new Date('2026-09-01T10:00:00.000Z'));
  const db = new FakeDb(clock);
  const connections = new FakeConnections();
  const queue = new FakeQueue();
  const deps: ChatDeps = {
    db,
    connections,
    queue,
    ids: new FakeIds(),
    clock,
    logger: noopLogger,
  };
  return { deps, db, connections, queue };
}
