/**
 * SMS gateway port (MSG91/Twilio). Faked in tests — no real network.
 * The message body must be non-PHI: only the OTP + app name + validity.
 */
export interface SmsGateway {
  send(input: { to: string; message: string }): Promise<void>;
}
