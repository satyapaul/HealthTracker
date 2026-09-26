/**
 * dose Lambda — placeholder handler (Phase 0.1 scaffold).
 * Real implementation (dose responses, dose history) lands in Phase 2.
 * See docs/LLD-Technical-Design.md §4.4.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return { statusCode: 501, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
};
