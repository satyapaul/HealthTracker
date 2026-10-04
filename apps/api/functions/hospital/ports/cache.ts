/**
 * Picker cache port (LLD §4.16 / §5.3 `hospitals:picker:{doctorId}`).
 *
 * The picker list is small bounded reference data; the production adapter caches
 * it in Redis with a 300s TTL and invalidates on affiliation/hospital changes.
 * Modeling it as a port keeps the service logic testable; the real adapter is a
 * deferred infra concern. A no-op cache (always miss) is a valid default.
 */
export interface PickerCache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttlSeconds: number): Promise<void>;
}
