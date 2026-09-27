/**
 * OTP service: send + verify flows. No OTP or phone in logs/responses.
 */
import { createHash } from 'node:crypto';
import type { AuthDeps } from '../deps';
import { AppError } from '../envelope';

/** E.164: leading +, first digit 1-9, up to 14 more digits. */
const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

export function otpRateKey(phone: string): string {
  return `otp_rate:${phone}`;
}

/**
 * Opaque, non-reversible reference for a phone number, safe for audit records.
 * Never store the raw phone in audit (conventions.md).
 */
export function phoneRef(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 32);
}

/** Build the non-PHI SMS body: OTP + app name + validity only. */
export function buildSmsMessage(appName: string, code: string, ttlSeconds: number): string {
  const minutes = Math.round(ttlSeconds / 60);
  return `${appName}: ${code} is your verification code. Valid for ${minutes} minutes.`;
}

/** Enforce the OTP-send rate limit (max N per window). Throws RATE_LIMITED. */
export async function enforceSendRateLimit(deps: AuthDeps, phone: string): Promise<void> {
  const key = otpRateKey(phone);
  const count = await deps.redis.incr(key);
  if (count === 1) {
    await deps.redis.expire(key, deps.config.otpSendWindowSeconds);
  }
  if (count > deps.config.otpSendMaxPerHour) {
    throw new AppError('RATE_LIMITED', 'Too many OTP requests. Try again later.');
  }
}
