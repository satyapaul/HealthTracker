/**
 * Chat business logic (WP 5.1 — spec §7.8, LLD §4.19).
 *
 * sendMessage (WebSocket + the shared logic):
 *   - Authorize thread membership (RLS is the hard gate; the service adds the
 *     role/consult_view rules).
 *   - Require body OR attachment.
 *   - Release state: a message whose attachment is not yet `clean` is stored
 *     with is_released=FALSE and is NOT pushed; the virus-scan Lambda releases
 *     it when the chat-media scan clears (HLD §4.7).
 *   - Insert the IMMUTABLE message (append-only, C-10) + link any attachment.
 *   - If released: push to connected thread members (synchronous, <1s path) and
 *     publish ChatMessageReceived for offline recipients / alerts.
 *
 * No PHI leaves in logs or the ChatMessageReceived payload (deep link only).
 */
import { AppError } from '../envelope';
import type { ChatDeps } from '../deps';
import type {
  MessageRecord,
  SenderRole,
  SessionContext,
  ThreadRecord,
  ThreadType,
  UrgencyFlag,
} from '../ports';

export interface Principal {
  userId: string;
  role: 'patient' | 'caregiver' | 'doctor' | 'admin';
  patientId?: string | null;
}

function sessionContext(principal: Principal): SessionContext {
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    const patientId =
      typeof principal.patientId === 'string' && principal.patientId.length > 0
        ? principal.patientId
        : null;
    return { userId: principal.userId, role: principal.role, patientId };
  }
  return { userId: principal.userId, role: principal.role, patientId: null };
}

const URGENCY: readonly UrgencyFlag[] = ['routine_query', 'symptom_concern'];

export interface SendMessageCommand {
  threadId: string;
  body?: string;
  urgencyFlag?: string;
  linkedFollowUpRowId?: string;
  attachment?: {
    objectKey: string;
    mimeType: string;
    /** Current scan status of the confirmed upload (pending|clean|quarantined). */
    scanStatus: 'pending' | 'clean' | 'quarantined';
  };
}

export interface SendMessageResult {
  messageId: string;
  createdAt: string;
  released: boolean;
}

/** Validate + persist a chat message, then push/publish if released. */
export async function sendMessage(
  deps: ChatDeps,
  principal: Principal,
  cmd: SendMessageCommand
): Promise<SendMessageResult> {
  const ctx = sessionContext(principal);

  const body = typeof cmd.body === 'string' && cmd.body.trim() !== '' ? cmd.body.trim() : null;
  const hasAttachment = !!cmd.attachment;
  if (body === null && !hasAttachment) {
    throw new AppError('VALIDATION_ERROR', 'A message body or attachment is required');
  }

  // A quarantined attachment can never be posted.
  if (cmd.attachment && cmd.attachment.scanStatus === 'quarantined') {
    throw new AppError('ATTACHMENT_NOT_CLEAN', 'Attachment failed the virus scan');
  }

  const urgencyFlag: UrgencyFlag =
    cmd.urgencyFlag !== undefined
      ? (() => {
          if (!(URGENCY as readonly string[]).includes(cmd.urgencyFlag!)) {
            throw new AppError('VALIDATION_ERROR', "Field 'urgencyFlag' is invalid", {
              field: 'urgencyFlag',
            });
          }
          return cmd.urgencyFlag as UrgencyFlag;
        })()
      : 'routine_query';

  const senderRole = principal.role as SenderRole; // patient|caregiver|doctor

  // A message with a not-yet-clean attachment is held until the scan clears.
  const isReleased = !(hasAttachment && cmd.attachment!.scanStatus !== 'clean');

  const { message, recipients } = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);

    // Membership authz: the thread must be visible to the caller (RLS). A
    // consult_view doctor cannot post to a patient_care_team thread — that role
    // arrives in Phase 6; the check is a no-op today but kept as the seam.
    const thread = await repo.findThreadById(cmd.threadId);
    if (!thread) {
      throw new AppError('FORBIDDEN', 'Not a member of this thread');
    }
    assertCanPost(principal, thread);

    const msg = await repo.insertMessage({
      id: deps.ids.uuid(),
      threadId: cmd.threadId,
      senderUserId: principal.userId,
      senderRole,
      body,
      urgencyFlag,
      linkedFollowUpRowId: cmd.linkedFollowUpRowId ?? null,
      isReleased,
    });

    if (cmd.attachment) {
      await repo.insertAttachment({
        id: deps.ids.uuid(),
        messageId: msg.id,
        objectKey: cmd.attachment.objectKey,
        mimeType: cmd.attachment.mimeType,
        scanStatus: cmd.attachment.scanStatus,
      });
    }

    const members = await repo.threadMemberUserIds(cmd.threadId, principal.userId);
    return { message: msg, recipients: members, patientId: thread.patientId };
  });

  // Deliver only released messages. A held (pending-scan) message is delivered
  // later by the virus-scan Lambda when it flips is_released=TRUE.
  if (isReleased) {
    await deliver(deps, message, recipients, principal, cmd.threadId);
  }

  deps.logger.info('chat.message.sent', {
    threadId: cmd.threadId,
    messageId: message.id,
    userId: principal.userId,
    released: isReleased,
    hasAttachment,
  });

  return { messageId: message.id, createdAt: message.createdAt, released: isReleased };
}

/** Post-commit delivery: synchronous push to connected members (<1s), + event. */
async function deliver(
  deps: ChatDeps,
  message: MessageRecord,
  recipientUserIds: string[],
  principal: Principal,
  threadId: string
): Promise<void> {
  // Push to each connected recipient (no PHI in the frame beyond ids + flag;
  // the client fetches the body under its own RLS-scoped read).
  for (const userId of recipientUserIds) {
    const connectionId = await deps.connections.connectionFor(userId);
    if (connectionId) {
      await deps.connections.push(connectionId, {
        type: 'chat.message',
        threadId,
        messageId: message.id,
        senderUserId: principal.userId,
        urgencyFlag: message.urgencyFlag,
        createdAt: message.createdAt,
      });
    }
  }

  // Offline recipients + urgency alerts are handled by the dispatcher. A
  // symptom_concern message escalates (C-07): the dispatcher adds a doctor-
  // dashboard triage alert + SMS/WhatsApp on top of the normal fan-out.
  await deps.queue.chatMessageReceived({
    threadId,
    messageId: message.id,
    patientId: '', // dispatcher resolves recipients; patientId not needed here
    urgencyFlag: message.urgencyFlag,
    escalate: message.urgencyFlag === 'symptom_concern',
    recipientUserIds,
  });
}

/**
 * App-layer posting rule. RLS already restricts which threads a caller sees;
 * this adds the consult_view-cannot-post-to-care-team rule (Phase 6 role —
 * a no-op seam today) and keeps system cards out of the user path.
 */
function assertCanPost(principal: Principal, _thread: ThreadRecord): void {
  if (principal.role === 'admin') {
    // Admins do not post chat messages in the product flow.
    throw new AppError('FORBIDDEN', 'Admins cannot post chat messages');
  }
  // patient/caregiver/doctor posting is governed by RLS visibility of the
  // thread (already checked). consult_view restriction lands in Phase 6.
}

// ── System event cards (WP 5.2 — C-03) ──────────────────────────────────────

export interface PostSystemCardCommand {
  patientId: string;
  /** The card copy (in-app content — clinical specifics allowed, unlike SMS). */
  text: string;
  linkedFollowUpRowId?: string;
}

export interface PostSystemCardResult {
  messageId: string;
  threadId: string;
}

/**
 * Post an automated system card into a patient's care-team thread (C-03).
 * Runs under a trusted system (admin) context: ensures the thread exists,
 * appends an immutable system message (sender_role='system', sender_user_id
 * NULL), then delivers it like a released message (push + ChatMessageReceived).
 *
 * Called by the followup/dose (and later care-team/transfers) domains via the
 * SystemCardPoster port — never on a user's behalf, so it is not gated by the
 * user insert policies (see V12 cm_system_insert).
 */
export async function postSystemCard(
  deps: ChatDeps,
  cmd: PostSystemCardCommand
): Promise<PostSystemCardResult> {
  const ctx: SessionContext = { userId: 'system', role: 'admin', patientId: null };

  const { card, recipients, threadId } = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const tid = await repo.ensureCareTeamThread(cmd.patientId, deps.ids.uuid());
    const message = await repo.insertSystemCard({
      id: deps.ids.uuid(),
      threadId: tid,
      body: cmd.text,
      linkedFollowUpRowId: cmd.linkedFollowUpRowId ?? null,
    });
    const members = await repo.threadAllMemberUserIds(tid);
    return { card: message, recipients: members, threadId: tid };
  });

  // Deliver to connected members; a system card is always released.
  for (const userId of recipients) {
    const connectionId = await deps.connections.connectionFor(userId);
    if (connectionId) {
      await deps.connections.push(connectionId, {
        type: 'chat.message',
        threadId,
        messageId: card.id,
        senderUserId: null,
        urgencyFlag: card.urgencyFlag,
        createdAt: card.createdAt,
      });
    }
  }
  await deps.queue.chatMessageReceived({
    threadId,
    messageId: card.id,
    patientId: cmd.patientId,
    urgencyFlag: card.urgencyFlag,
    escalate: false, // system cards are informational, never a triage escalation
    recipientUserIds: recipients,
  });

  deps.logger.info('chat.system_card.posted', {
    threadId,
    messageId: card.id,
    patientId: cmd.patientId,
  });

  return { messageId: card.id, threadId };
}

// ── Read receipts (WP 5.3 — C-05) ────────────────────────────────────────────

export interface MarkReadCommand {
  threadId: string;
  messageIds: string[];
}

export interface MarkReadResult {
  updated: number;
}

/**
 * Mark messages read by the caller (C-05). Appends the reader to each message's
 * read_by_user_ids (idempotent, via chat_mark_read), then pushes read receipts
 * to the other connected thread members. Requires thread membership (RLS).
 */
export async function markRead(
  deps: ChatDeps,
  principal: Principal,
  cmd: MarkReadCommand
): Promise<MarkReadResult> {
  const ctx = sessionContext(principal);

  const recipients = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const thread = await repo.findThreadById(cmd.threadId);
    if (!thread) {
      throw new AppError('FORBIDDEN', 'Not a member of this thread');
    }
    for (const messageId of cmd.messageIds) {
      await repo.markRead(messageId, principal.userId);
    }
    return repo.threadMemberUserIds(cmd.threadId, principal.userId);
  });

  // Push read receipts to the other connected members (ids only, no PHI).
  for (const userId of recipients) {
    const connectionId = await deps.connections.connectionFor(userId);
    if (connectionId) {
      await deps.connections.push(connectionId, {
        type: 'chat.read',
        threadId: cmd.threadId,
        messageIds: cmd.messageIds,
        readerUserId: principal.userId,
      });
    }
  }

  deps.logger.info('chat.read', {
    threadId: cmd.threadId,
    userId: principal.userId,
    count: cmd.messageIds.length,
  });

  return { updated: cmd.messageIds.length };
}

// ── Typing indicator (WP 5.3 — ephemeral, no DB) ─────────────────────────────

export interface TypingCommand {
  threadId: string;
  isTyping: boolean;
}

/**
 * Broadcast an ephemeral typing indicator to the other connected thread
 * members. No DB write, no notification fan-out (LLD §3.14). Requires
 * membership (RLS).
 */
export async function typing(
  deps: ChatDeps,
  principal: Principal,
  cmd: TypingCommand
): Promise<void> {
  const ctx = sessionContext(principal);

  const recipients = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const thread = await repo.findThreadById(cmd.threadId);
    if (!thread) {
      throw new AppError('FORBIDDEN', 'Not a member of this thread');
    }
    return repo.threadMemberUserIds(cmd.threadId, principal.userId);
  });

  for (const userId of recipients) {
    const connectionId = await deps.connections.connectionFor(userId);
    if (connectionId) {
      await deps.connections.push(connectionId, {
        type: 'chat.typing',
        threadId: cmd.threadId,
        userId: principal.userId,
        isTyping: cmd.isTyping,
      });
    }
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** List threads for a patient (RLS-scoped; patient sees only their care_team). */
export async function listThreads(
  deps: ChatDeps,
  principal: Principal,
  patientId: string
): Promise<ThreadRecord[]> {
  const ctx = sessionContext(principal);
  return deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.listThreads(patientId);
  });
}

/** List released messages in a thread (RLS-scoped). */
export async function listMessages(
  deps: ChatDeps,
  principal: Principal,
  threadId: string
): Promise<MessageRecord[]> {
  const ctx = sessionContext(principal);
  return deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const thread = await repo.findThreadById(threadId);
    if (!thread) {
      throw new AppError('FORBIDDEN', 'Not a member of this thread');
    }
    return repo.listMessages(threadId);
  });
}

export type { ThreadType };
