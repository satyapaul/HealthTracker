/** Clock port — injectable so tests are deterministic. */
export interface Clock {
  now(): Date;
}
