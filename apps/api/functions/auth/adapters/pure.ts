/**
 * Pure (no-IO) production adapters: hasher, id/token generation, clock, logger.
 * These have no external dependencies beyond bcryptjs + node:crypto and are the
 * same in prod and (optionally) tests.
 */
import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Hasher } from '../ports/hasher';
import type { IdGenerator } from '../ports/ids';

const BCRYPT_ROUNDS = 10;

export const bcryptHasher: Hasher = {
  hash: (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS),
  compare: (plain, hash) => bcrypt.compare(plain, hash),
};

export const cryptoIds: IdGenerator = {
  uuid: () => randomUUID(),
  // 32 random bytes, base64url — opaque and unguessable.
  sessionToken: () =>
    randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  // Uniform 6-digit code, zero-padded.
  otpCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
};
