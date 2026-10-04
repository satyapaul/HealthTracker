/**
 * Ports for the chat domain (WP 5.1).
 *
 * DB access runs under the caller's RLS context (chat_threads/chat_messages
 * policies gate membership + visibility). Pushing to connected members uses the
 * API Gateway Management API (ConnectionPush); the per-user connection lookup
 * uses the Redis ws:user:{userId} store (ConnStore). The ChatMessageReceived
 * event goes to the notification pipeline (QueuePort). Concrete adapters are
 * deferred to infra; faked in tests.
 */

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type SenderRole = 'patient' | 'caregiver' | 'doctor' | 'system';
export type ThreadType = 'patient_care_team' | 'doctor_internal_consult';
export type UrgencyFlag = 'routine_query' | 'symptom_concern';
export type ScanStatus = 'pending' | 'clean' | 'quarantined';

export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface ThreadRecord {
  id: string;
  patientId: string;
  threadType: ThreadType;
  createdAt: string;
}

export interface MessageRecord {
  id: string;
  threadId: string;
  senderUserId: string | null;
  senderRole: SenderRole;
  body: string | null;
  urgencyFlag: UrgencyFlag;
  linkedFollowUpRowId: string | null;
  isReleased: boolean;
  createdAt: string;
}

export interface NewMessageInput {
  id: string;
  threadId: string;
  senderUserId: string;
  senderRole: SenderRole;
  body: string | null;
  urgencyFlag: UrgencyFlag;
  linkedFollowUpRowId: string | null;
  isReleased: boolean;
}

/** A system card to append (WP 5.2 — C-03). sender_user_id is NULL. */
export interface NewSystemCardInput {
  id: string;
  threadId: string;
  body: string;
  linkedFollowUpRowId: string | null;
}

export interface NewAttachmentInput {
  id: string;
  messageId: string;
  objectKey: string;
  mimeType: string;
  /** Scan status of the already-confirmed upload (pending|clean). */
  scanStatus: ScanStatus;
}

/** Transaction-scoped chat repository (RLS-gated). */
export interface ChatRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  /** The thread by id (RLS-scoped — null if the caller cannot see it). */
  findThreadById(threadId: string): Promise<ThreadRecord | null>;
  /** Threads for a patient visible to the caller (RLS-scoped). */
  listThreads(patientId: string): Promise<ThreadRecord[]>;
  /** Released messages in a thread (RLS-scoped), oldest first. */
  listMessages(threadId: string): Promise<MessageRecord[]>;

  /** Append an immutable message. */
  insertMessage(input: NewMessageInput): Promise<MessageRecord>;
  /** Link an attachment to a message. */
  insertAttachment(input: NewAttachmentInput): Promise<void>;

  /** The other user ids in a thread (for push fan-out), excluding `exceptUserId`. */
  threadMemberUserIds(threadId: string, exceptUserId: string): Promise<string[]>;

  // ── System cards (WP 5.2) ────────────────────────────────────────────────
  /** Find or create the patient_care_team thread for a patient; returns its id. */
  ensureCareTeamThread(patientId: string, newThreadId: string): Promise<string>;
  /** Append an immutable system card (sender_role='system', sender_user_id NULL). */
  insertSystemCard(input: NewSystemCardInput): Promise<MessageRecord>;
  /** The user ids to notify for a thread's patient (full membership). */
  threadAllMemberUserIds(threadId: string): Promise<string[]>;
}

export interface DbPort {
  transaction<T>(fn: (repo: ChatRepository) => Promise<T>): Promise<T>;
}

/** Push a JSON frame to a user's open WebSocket connection, if any. */
export interface ConnectionPush {
  /** Resolve the user's active connectionId, or null if not connected. */
  connectionFor(userId: string): Promise<string | null>;
  /** POST a payload to a connection. Resolves false on a stale (410) connection. */
  push(connectionId: string, payload: Record<string, unknown>): Promise<boolean>;
}

/** Publish the ChatMessageReceived event (offline push / alerts via dispatcher). */
export interface ChatEventQueue {
  chatMessageReceived(input: {
    threadId: string;
    messageId: string;
    patientId: string;
    urgencyFlag: UrgencyFlag;
    recipientUserIds: string[];
  }): Promise<void>;
}

export interface IdGenerator {
  uuid(): string;
}
export interface Clock {
  now(): Date;
}
