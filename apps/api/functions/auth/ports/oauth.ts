/**
 * OAuth provider port (Google + X). Wraps the token exchange + ID token
 * validation HTTP calls. Faked in tests — no real network.
 *
 * Implementations must validate issuer/audience/expiry/signature and throw an
 * AppError('UNAUTHENTICATED') on any validation failure, or
 * AppError('SERVICE_UNAVAILABLE') when the provider is unreachable.
 */

export interface OAuthProfile {
  providerSubject: string;
  email: string | null;
  /**
   * Whether the provider asserts that `email` has been verified by the
   * provider. Only a verified email may be used as the join key for
   * account-linking (see services/identity.ts). Providers that do not assert
   * a verified-email guarantee (or synthesized profiles, e.g. the SMS/OTP
   * path) must set this to `false`.
   */
  emailVerified: boolean;
  displayName: string;
}

export interface GoogleExchangeInput {
  code: string;
  redirectUri: string;
}

export interface XExchangeInput {
  code: string;
  codeVerifier: string;
}

export interface GoogleOAuthPort {
  /** Exchange the auth code, validate the ID token, return the verified profile. */
  exchangeAndVerify(input: GoogleExchangeInput): Promise<OAuthProfile>;
}

export interface XOAuthPort {
  /** Exchange the auth code (PKCE), validate the token, return the verified profile. */
  exchangeAndVerify(input: XExchangeInput): Promise<OAuthProfile>;
}
