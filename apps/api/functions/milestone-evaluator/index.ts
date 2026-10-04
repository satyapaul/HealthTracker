/**
 * milestone-evaluator Lambda entry (WP 4.2 — LLD §4.6).
 *
 * Triggered by EventBridge Scheduler (two rules: daily 08:00 IST + hourly). It
 * fires due reminders (enqueue to per-channel FIFO with {reminderId}#{channel}
 * dedup) and flags overdue milestones. The evaluation logic lives in the
 * `milestone` domain (evaluator-service), which takes deps as parameters so
 * unit tests inject fakes.
 */
import { buildEvaluatorDeps } from '../milestone/factory';
import { evaluate, type EvaluationResult } from '../milestone/services/evaluator-service';

/** The scheduler passes a small input ({ scope }); not required by the logic. */
export interface SchedulerEvent {
  scope?: string;
}

export const handler = async (_event: SchedulerEvent): Promise<EvaluationResult> => {
  const deps = buildEvaluatorDeps(process.env);
  return evaluate(deps);
};
