/**
 * Dependency bundles for the notification dispatcher and the channel senders.
 */
import type {
  DbTransactor,
  QueuePort,
  IdGenerator,
  Clock,
  DeliveryPort,
  ChannelProvider,
} from './ports';
import type { Logger } from './logger';

/** Dispatcher deps: resolve targets, write in-app rows, enqueue per channel. */
export interface DispatcherDeps {
  db: DbTransactor;
  queue: QueuePort;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
  config: {
    /** Base URL for deep links (never contains PHI). */
    appBaseUrl: string;
    appName: string;
  };
}

/** Sender deps: a single channel provider + the idempotent delivery store. */
export interface SenderDeps {
  provider: ChannelProvider;
  delivery: DeliveryPort;
  logger: Logger;
}
