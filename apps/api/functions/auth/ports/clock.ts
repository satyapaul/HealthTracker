/** Injectable clock so tests are deterministic (no real Date.now in core logic). */
export interface Clock {
  /** Current time. */
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
