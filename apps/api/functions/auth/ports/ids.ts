/**
 * Injectable id/token/OTP generation so tests are deterministic and no
 * randomness leaks into core logic.
 */
export interface IdGenerator {
  /** A UUID for DB primary keys. */
  uuid(): string;
  /** An opaque, unguessable session token. */
  sessionToken(): string;
  /** A 6-digit numeric OTP as a string (e.g. "042317"). */
  otpCode(): string;
}
