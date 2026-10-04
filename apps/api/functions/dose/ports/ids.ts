/** ID generation port — injectable so tests are deterministic. */
export interface IdGenerator {
  uuid(): string;
}
