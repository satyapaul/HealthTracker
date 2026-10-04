/**
 * Structured JSON logger. IMPORTANT (conventions.md): NO PHI. Never log message
 * bodies, attachment contents, or names — only opaque ids (threadId, messageId,
 * userId, patientId), roles, and event types.
 */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function emit(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields?: Record<string, unknown>
): void {
  const line = JSON.stringify({ level, event, ...fields, ts: new Date().toISOString() });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const consoleLogger: Logger = {
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
};
