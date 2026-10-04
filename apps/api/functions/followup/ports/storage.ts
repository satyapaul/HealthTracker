/**
 * Storage + upload-intent ports for the lab-report attachment flow (WP 2.4).
 *
 * These wrap real AWS primitives (S3 presigned PUT, HeadObject) and the Redis
 * upload-intent cache behind interfaces so the presign/confirm business logic
 * is fully unit-testable with fakes. The concrete adapters (AWS SDK v3 S3
 * client, Redis) are thin and wired in a later infra step — the actual S3
 * round-trip is part of the deferred live-infra verification.
 */

/** Result of generating a presigned upload. */
export interface PresignedUpload {
  uploadUrl: string;
  expiresAt: string; // ISO timestamp
}

export interface S3Port {
  /**
   * Generate a presigned PUT URL for `objectKey`, constrained to `contentType`
   * and a max byte size (the adapter sets Content-Type + Content-Length-Range
   * conditions). TTL is adapter-configured (PRESIGN_TTL_SECONDS).
   */
  presignPut(objectKey: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;

  /** True if the object exists in the lab-reports bucket (confirm-step check). */
  objectExists(objectKey: string): Promise<boolean>;
}

/** Pending upload intent recorded at presign time, verified at confirm time. */
export interface UploadIntent {
  rowId: string;
  patientId: string;
  uploadedBy: string;
  mimeType: string;
  originalFilename: string;
}

export interface UploadIntentCache {
  /** Store an intent keyed by objectKey, with a TTL (seconds). */
  put(objectKey: string, intent: UploadIntent, ttlSeconds: number): Promise<void>;
  /** Fetch an intent by objectKey, or null if absent/expired. */
  get(objectKey: string): Promise<UploadIntent | null>;
  /** Remove an intent (after a successful confirm). */
  del(objectKey: string): Promise<void>;
}
