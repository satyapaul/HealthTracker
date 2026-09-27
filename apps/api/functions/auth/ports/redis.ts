/**
 * Minimal Redis port covering the auth flows (LLD §5.1):
 *   session:{token}, oauth_state:{state}, oauth_pkce:{state},
 *   otp_rate:{phone}, otp_verify_rate:{challengeId}.
 * Faked in tests — no real network.
 */
export interface RedisPort {
  /** GET key -> value or null. */
  get(key: string): Promise<string | null>;
  /** SET key value with a TTL (seconds). */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** DEL key. Returns number of keys removed. */
  del(key: string): Promise<number>;
  /** INCR key -> new integer value. */
  incr(key: string): Promise<number>;
  /** EXPIRE key ttlSeconds. */
  expire(key: string, ttlSeconds: number): Promise<void>;
}
