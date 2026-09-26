/**
 * auth Lambda — placeholder handler (Phase 0.1 scaffold).
 * Real implementation (Google/X OAuth, SMS OTP, JWT sessions) lands in Phase 1.
 * See docs/LLD-Technical-Design.md §4.1.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return { statusCode: 501, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
};
