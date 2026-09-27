/**
 * Placeholder production adapters for the stateful IO ports (Postgres via RDS
 * Proxy, Redis/ElastiCache, DynamoDB audit, Secrets Manager).
 *
 * WP 1.1 scope is the auth *application logic* + unit tests with injected fakes.
 * The concrete clients (pg + RDS Proxy, ioredis, @aws-sdk/* ) are wired when the
 * corresponding infra + connection plumbing lands (see infra/ stacks). Until
 * then these adapters are constructed from env so the factory shape is real,
 * but any actual call fails fast and loudly with SERVICE_UNAVAILABLE rather
 * than pretending to connect.
 *
 * IMPORTANT: this file is never exercised by unit tests — tests inject fakes.
 */
import { AppError } from '../envelope';
import type { DbPort } from '../ports/db';
import type { RedisPort } from '../ports/redis';
import type { AuditWriter } from '../ports/audit';
import type { SecretsProvider } from '../ports/secrets';

function unavailable(component: string): never {
  throw new AppError('SERVICE_UNAVAILABLE', `${component} client not wired in this build`);
}

export interface DbAdapterConfig {
  proxyEndpoint: string;
  dbName: string;
}

export interface RedisAdapterConfig {
  endpoint: string;
  port: number;
}

export function makeDbPort(_cfg: DbAdapterConfig): DbPort {
  return {
    transaction: () => unavailable('Database'),
  };
}

export function makeRedisPort(_cfg: RedisAdapterConfig): RedisPort {
  return {
    get: () => unavailable('Redis'),
    set: () => unavailable('Redis'),
    del: () => unavailable('Redis'),
    incr: () => unavailable('Redis'),
    expire: () => unavailable('Redis'),
  };
}

export function makeAuditWriter(): AuditWriter {
  return {
    write: () => unavailable('Audit'),
  };
}

export function makeSecretsProvider(): SecretsProvider {
  return {
    getSecret: () => unavailable('Secrets'),
  };
}
