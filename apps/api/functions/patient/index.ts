/**
 * patient Lambda — placeholder handler (Phase 0.1 scaffold).
 * Real implementation (patient profile, notification prefs) lands in Phase 2.
 * See docs/LLD-Technical-Design.md §4.2.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return { statusCode: 501, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
};
