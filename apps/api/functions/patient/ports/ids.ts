/** ID generation port — injectable so tests are deterministic. */
export interface IdGenerator {
  /** A new patient/chart UUID. */
  uuid(): string;
}
