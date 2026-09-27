/** Injectable password/OTP hasher (bcrypt in prod, fake in tests). */
export interface Hasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}
