/**
 * admin Lambda — placeholder handler (Phase 0.1 scaffold).
 * Real implementation (patients, invites, roles, protocols, hospital registry) lands in Phases 2–3.
 * See docs/LLD-Technical-Design.md §4.14.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  return { statusCode: 501, body: JSON.stringify({ error: 'NOT_IMPLEMENTED' }) };
};
