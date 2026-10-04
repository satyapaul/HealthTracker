/** ID generation port — injectable so tests are deterministic. */
export interface IdGenerator {
  /** A new follow-up row UUID. */
  uuid(): string;
}
