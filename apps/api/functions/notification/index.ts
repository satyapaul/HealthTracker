/**
 * notification Lambda entry — placeholder handlers (Phase 0.1 scaffold).
 *
 * This single entry backs multiple functions in ComputeStack (see
 * infra/lib/stacks/compute-stack.ts): the dispatcher uses the default `handler`,
 * and each channel sender uses a namespaced export (`sms.handler`,
 * `whatsapp.handler`, `email.handler`, `inapp.handler`).
 * Real implementation lands in Phase 4. See docs/LLD-Technical-Design.md §4.7–4.11.
 */

type Result = Promise<void>;

/** Dispatcher: fans events out to per-channel FIFO queues (§4.7). */
export const handler = async (): Result => {
  // no-op until Phase 4
};

/** SMS channel sender (§4.8) — referenced as `sms.handler`. */
export const sms = {
  handler: async (): Result => {
    // no-op until Phase 4
  },
};

/** WhatsApp channel sender (§4.9) — referenced as `whatsapp.handler`. */
export const whatsapp = {
  handler: async (): Result => {
    // no-op until Phase 4
  },
};

/** Email channel sender (§4.10) — referenced as `email.handler`. */
export const email = {
  handler: async (): Result => {
    // no-op until Phase 4
  },
};

/** In-app (WebSocket push) channel sender (§4.11) — referenced as `inapp.handler`. */
export const inapp = {
  handler: async (): Result => {
    // no-op until Phase 4
  },
};
