/**
 * Dependency bundle for the chat domain.
 */
import type { DbPort, ConnectionPush, ChatEventQueue, IdGenerator, Clock } from './ports';
import type { Logger } from './logger';

export interface ChatDeps {
  db: DbPort;
  connections: ConnectionPush;
  queue: ChatEventQueue;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
}
