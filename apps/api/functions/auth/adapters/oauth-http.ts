/**
 * HTTP OAuth adapters (Google + X) using the global fetch (Node 22).
 *
 * These translate upstream failures into typed AppErrors:
 *  - token/ID-token validation failure -> UNAUTHENTICATED (401)
 *  - provider unreachable / non-2xx transport -> SERVICE_UNAVAILABLE (503)
 *
 * Secrets (client secret) are resolved lazily via the SecretsProvider and are
 * never logged.
 */
import { AppError } from '../envelope';
import type { GoogleOAuthPort, XOAuthPort, OAuthProfile } from '../ports/oauth';
import type { SecretsProvider } from '../ports/secrets';

interface GoogleConfig {
  clientId: string;
  clientSecretArn: string;
  tokenEndpoint: string;
  tokenInfoEndpoint: string;
}

interface XConfig {
  clientId: string;
  clientSecretArn: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
}

async function postForm(url: string, form: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'OAuth provider unreachable');
  }
  if (res.status >= 500) {
    throw new AppError('SERVICE_UNAVAILABLE', 'OAuth provider error');
  }
  if (!res.ok) {
    throw new AppError('UNAUTHENTICATED', 'OAuth token exchange failed');
  }
  return res.json();
}

export function makeGoogleOAuth(cfg: GoogleConfig, secrets: SecretsProvider): GoogleOAuthPort {
  return {
    async exchangeAndVerify({ code, redirectUri }) {
      const clientSecret = await secrets.getSecret(cfg.clientSecretArn);
      const tokens = (await postForm(cfg.tokenEndpoint, {
        code,
        client_id: cfg.clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })) as { id_token?: string };

      if (!tokens.id_token) {
        throw new AppError('UNAUTHENTICATED', 'Missing ID token');
      }

      // Validate the ID token (issuer/audience/expiry) via Google's tokeninfo.
      let res: Response;
      try {
        res = await fetch(
          `${cfg.tokenInfoEndpoint}?id_token=${encodeURIComponent(tokens.id_token)}`
        );
      } catch {
        throw new AppError('SERVICE_UNAVAILABLE', 'OAuth provider unreachable');
      }
      if (!res.ok) {
        throw new AppError('UNAUTHENTICATED', 'ID token validation failed');
      }
      const claims = (await res.json()) as {
        sub?: string;
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        exp?: string | number;
      };
      if (!claims.sub || claims.aud !== cfg.clientId) {
        throw new AppError('UNAUTHENTICATED', 'ID token validation failed');
      }
      // Google's tokeninfo returns email_verified as the string 'true'/'false'
      // (or a boolean depending on the endpoint). Only treat an explicit true
      // as verified.
      const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
      const profile: OAuthProfile = {
        providerSubject: claims.sub,
        email: claims.email ?? null,
        emailVerified,
        displayName: claims.name ?? claims.email ?? claims.sub,
      };
      return profile;
    },
  };
}

export function makeXOAuth(cfg: XConfig, secrets: SecretsProvider): XOAuthPort {
  return {
    async exchangeAndVerify({ code, codeVerifier }) {
      const clientSecret = await secrets.getSecret(cfg.clientSecretArn);
      const tokens = (await postForm(cfg.tokenEndpoint, {
        code,
        client_id: cfg.clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
      })) as { access_token?: string };

      if (!tokens.access_token) {
        throw new AppError('UNAUTHENTICATED', 'Token exchange failed');
      }

      let res: Response;
      try {
        res = await fetch(cfg.userInfoEndpoint, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
      } catch {
        throw new AppError('SERVICE_UNAVAILABLE', 'OAuth provider unreachable');
      }
      if (res.status >= 500) {
        throw new AppError('SERVICE_UNAVAILABLE', 'OAuth provider error');
      }
      if (!res.ok) {
        throw new AppError('UNAUTHENTICATED', 'User info fetch failed');
      }
      const data = (await res.json()) as {
        data?: { id?: string; name?: string; username?: string };
      };
      const u = data.data;
      if (!u?.id) {
        throw new AppError('UNAUTHENTICATED', 'User info missing subject');
      }
      // X (v2 /users/me) does not return an email at all, and offers no
      // verified-email guarantee, so we never carry a verified email for X.
      const profile: OAuthProfile = {
        providerSubject: u.id,
        email: null,
        emailVerified: false,
        displayName: u.name ?? u.username ?? u.id,
      };
      return profile;
    },
  };
}
