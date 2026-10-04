/**
 * Ports for the milestone domain + evaluator (WP 4.2).
 *
 * DB access runs under RLS (doctor/admin). The evaluator's queue enqueue reuses
 * the WP 4.1 FIFO dedup convention. Concrete adapters are deferred to infra.
 */
import type { ReminderType } from './reminder-schedule';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type MilestoneType =
  | 'follow_up'
  | 'post_op_checkpoint'
  | 'drug_level'
  | 'doctor_ordered'
  | 'overdue';
export type MilestoneStatus = 'scheduled' | 'completed' | 'cancelled' | 'overdue';
export type MilestoneSource = 'protocol' | 'doctor' | 'system';
export type ReminderStatus = 'pending' | 'sent' | 'cancelled' | 'failed';

export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface MilestoneRecord {
  id: string;
  patientId: string;
  type: MilestoneType;
  title: string;
  description: string | null;
  dueDate: string;
  status: MilestoneStatus;
  source: MilestoneSource;
  linkedFollowUpRowId: string | null;
  createdAt: string;
}

export interface ReminderScheduleRecord {
  id: string;
  milestoneId: string;
  reminderType: ReminderType;
  offsetDays: number;
  scheduledAt: string;
  status: ReminderStatus;
}

export interface NewMilestoneInput {
  id: string;
  patientId: string;
  type: MilestoneType;
  title: string;
  description: string | null;
  dueDate: string;
  source: MilestoneSource;
}

export interface NewReminderInput {
  id: string;
  milestoneId: string;
  reminderType: ReminderType;
  offsetDays: number;
  scheduledAt: string;
}

/** A due reminder joined with the patient contact + preferences (evaluator). */
export interface DueReminder {
  reminderId: string;
  milestoneId: string;
  reminderType: ReminderType;
  patientId: string;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  hasPhone: boolean;
  hasWhatsapp: boolean;
}

/** Doctor-facing milestone repository (create/list). */
export interface MilestoneRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;
  isDoctorAssignedToPatient(doctorId: string, patientId: string): Promise<boolean>;
  createMilestone(input: NewMilestoneInput): Promise<MilestoneRecord>;
  addReminder(input: NewReminderInput): Promise<void>;
  listMilestonesForPatient(patientId: string): Promise<MilestoneRecord[]>;
}

export interface DbPort {
  transaction<T>(fn: (repo: MilestoneRepository) => Promise<T>): Promise<T>;
}

/**
 * Evaluator DB access (runs under a scoped admin/service context, not a user
 * principal). Reads due reminders, flips statuses, detects overdue.
 */
export interface EvaluatorDbPort {
  setSessionContext(ctx: SessionContext): Promise<void>;
  /** Due pending reminders (scheduled_at <= windowEnd, milestone scheduled, not opted out). */
  findDueReminders(windowEndIso: string): Promise<DueReminder[]>;
  markReminderSent(reminderId: string, sentAtIso: string): Promise<void>;
  /** Milestones past due still 'scheduled' -> returns their ids (to flag overdue). */
  findOverdueMilestoneIds(todayIso: string): Promise<string[]>;
  markMilestoneOverdue(milestoneId: string): Promise<void>;
}

export interface EvaluatorDbTransactor {
  transaction<T>(fn: (repo: EvaluatorDbPort) => Promise<T>): Promise<T>;
}

/** Channel for a reminder enqueue. */
export type ReminderChannel = 'sms' | 'whatsapp';

/** SQS FIFO enqueue for reminders (reuses the WP 4.1 dedup convention). */
export interface ReminderQueuePort {
  /**
   * Enqueue a reminder to a channel FIFO queue. dedupId = {reminderId}#{channel}
   * (LLD §6.2), so a reminder is delivered at most once per channel in the FIFO
   * dedup window.
   */
  enqueue(input: {
    reminderId: string;
    milestoneId: string;
    patientId: string;
    reminderType: ReminderType;
    channel: ReminderChannel;
    dedupId: string;
  }): Promise<void>;
}

export interface IdGenerator {
  uuid(): string;
}
export interface Clock {
  now(): Date;
}
