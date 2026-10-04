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

  // Offline recipients + urgency alerts are handled by the dispatcher.
  await deps.queue.chatMessageReceived({
    threadId,
    messageId: message.id,
    patientId: '', // dispatcher resolves recipients; patientId not needed here
    urgencyFlag: message.urgencyFlag,
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
