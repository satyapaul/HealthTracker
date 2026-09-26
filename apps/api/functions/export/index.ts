/**
 * export Lambda — placeholder handler (Phase 0.1 scaffold).
 * Real implementation (chart PDF export via Puppeteer) lands in Phase 7.
 * See docs/LLD-Technical-Design.md §4.13.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return { statusCode: 501, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
};
