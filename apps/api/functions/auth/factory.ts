/**
 * Build AuthDeps from environment variables. Never hardcodes secrets — secret
 * ARNs are read from env and resolved lazily via the SecretsProvider.
 */
import type { AuthConfig, AuthDeps } from './deps';
import { systemClock } from './ports/clock';
import { consoleLogger } from './logger';
import { bcryptHasher, cryptoIds } from './adapters/pure';
import { makeGoogleOAuth, makeXOAuth } from './adapters/oauth-http';
import { makeHttpSmsGateway } from './adapters/sms-http';
import {
  makeAuditWriter,
  makeDbPort,
  makeRedisPort,
  makeSecretsProvider,
} from './adapters/not-wired';

type Env = Record<string, string | undefined>;

function intEnv(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(env: Env, key: string, fallback = ''): string {
  return env[key] ?? fallback;
}

export function buildConfig(env: Env): AuthConfig {
  return {
    sessionTtlSeconds: intEnv(env, 'SESSION_TTL_SECONDS', 2_592_000),
    otpTtlSeconds: intEnv(env, 'OTP_TTL_SECONDS', 300),
    otpMaxAttempts: intEnv(env, 'OTP_MAX_ATTEMPTS', 5),
    otpSendMaxPerHour: intEnv(env, 'OTP_SEND_MAX_PER_HOUR', 3),
    otpSendWindowSeconds: intEnv(env, 'OTP_SEND_WINDOW_SECONDS', 3600),
    otpResendAfterSeconds: intEnv(env, 'OTP_RESEND_AFTER_SECONDS', 60),
    // Configurable branding — never hardcode a final brand name in logic.
    appName: strEnv(env, 'APP_NAME', 'PostOp Care'),
  };
}

export function buildDeps(env: Env): AuthDeps {
  const secrets = makeSecretsProvider();

  return {
    db: makeDbPort({
      proxyEndpoint: strEnv(env, 'DB_PROXY_ENDPOINT'),
      dbName: strEnv(env, 'DB_NAME'),
    }),
    redis: makeRedisPort({
      endpoint: strEnv(env, 'REDIS_ENDPOINT'),
      port: intEnv(env, 'REDIS_PORT', 6379),
    }),
    google: makeGoogleOAuth(
      {
        clientId: strEnv(env, 'GOOGLE_CLIENT_ID'),
        // Secret identifier: name or ARN (Secrets Manager accepts either).
        clientSecretArn:
          strEnv(env, 'GOOGLE_CLIENT_SECRET_ID') || strEnv(env, 'GOOGLE_CLIENT_SECRET_ARN'),
        tokenEndpoint: strEnv(env, 'GOOGLE_TOKEN_ENDPOINT', 'https://oauth2.googleapis.com/token'),
        tokenInfoEndpoint: strEnv(
          env,
          'GOOGLE_TOKENINFO_ENDPOINT',
          'https://oauth2.googleapis.com/tokeninfo'
        ),
      },
      secrets
    ),
    x: makeXOAuth(
      {
        clientId: strEnv(env, 'X_CLIENT_ID'),
        clientSecretArn: strEnv(env, 'X_CLIENT_SECRET_ID') || strEnv(env, 'X_CLIENT_SECRET_ARN'),
        tokenEndpoint: strEnv(env, 'X_TOKEN_ENDPOINT', 'https://api.x.com/2/oauth2/token'),
        userInfoEndpoint: strEnv(env, 'X_USERINFO_ENDPOINT', 'https://api.x.com/2/users/me'),
      },
      secrets
    ),
    sms: makeHttpSmsGateway(
      {
        endpoint: strEnv(env, 'SMS_API_ENDPOINT'),
        apiSecretArn: strEnv(env, 'SMS_API_SECRET_ID') || strEnv(env, 'SMS_API_SECRET_ARN'),
        sender: strEnv(env, 'SMS_SENDER_ID'),
      },
      secrets
    ),
    audit: makeAuditWriter(),
    hasher: bcryptHasher,
    clock: systemClock,
    ids: cryptoIds,
    logger: consoleLogger,
    config: buildConfig(env),
  };
}
