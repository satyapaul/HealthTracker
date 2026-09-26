/**
 * milestone Lambda — placeholder handler (Phase 0.1 scaffold).
 * Real implementation (milestone CRUD) lands in Phase 4.
 * See docs/LLD-Technical-Design.md §4.5.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return { statusCode: 501, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
};
