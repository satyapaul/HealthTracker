/**
 * Identity service: find-or-create the user for a verified provider profile,
 * linking auth_identities. Runs inside an open transaction.
 *
 * Rules (WP 1.1):
 * - If (provider, providerSubject) identity exists -> load user, update
 *   last_login_at.
 * - Else if a user with the same email exists:
 *     - Only auto-link a new identity to that user when the provider asserts
 *       the email is verified (profile.emailVerified === true). Using an
 *       unverified email as the join key is an account-takeover surface.
 *     - If the email matches but is NOT provider-verified, refuse to link or
 *       log in as that user -> CONFLICT (explicit/verified linking required).
 * - Else create a new user (role defaults to 'patient') + identity.
 */
import type { AuthDeps } from '../deps';
import type { AuthProvider, AuthRepository, UserRecord } from '../ports/db';
import type { OAuthProfile } from '../ports/oauth';
import { AppError } from '../envelope';

export interface ResolvedUser {
  user: UserRecord;
  created: boolean;
}

/** Find-or-create user by OAuth/SMS identity. */
export async function resolveUserForIdentity(
  deps: AuthDeps,
  repo: AuthRepository,
  provider: AuthProvider,
  profile: OAuthProfile
): Promise<ResolvedUser> {
  const existingIdentity = await repo.findIdentity(provider, profile.providerSubject);

  if (existingIdentity) {
    const user = await repo.findUserById(existingIdentity.userId);
    if (!user) {
      // Identity points at a missing user — treat as a data conflict rather
      // than silently minting a new account.
      throw new AppError('CONFLICT', 'Identity is linked to a missing account');
    }
    await repo.updateLastLogin(user.id, deps.clock.now());
    return { user, created: false };
  }

  // Account linking by email (only for providers that carry an email).
  if (profile.email) {
    const byEmail = await repo.findUserByEmail(profile.email);
    if (byEmail) {
      // Only auto-link when the provider asserts the email is verified.
      // Otherwise a matching-but-unverified email would let an inbound profile
      // be logged in AS the existing account — an account-takeover surface.
      // Refuse and require explicit/verified linking (safer default).
      if (!profile.emailVerified) {
        throw new AppError('CONFLICT', 'Email is already associated with an account');
      }
      await repo.createIdentity({
        id: deps.ids.uuid(),
        userId: byEmail.id,
        provider,
        providerSubject: profile.providerSubject,
        emailFromProvider: profile.email,
      });
      await repo.updateLastLogin(byEmail.id, deps.clock.now());
      return { user: byEmail, created: false };
    }
  }

  // Brand-new user. Role defaults to 'patient' (invite/allowlist elevation is a
  // later WP). Status active on first successful federated/OTP login.
  const userId = deps.ids.uuid();
  const user = await repo.createUser({
    id: userId,
    role: 'patient',
    displayName: profile.displayName,
    email: profile.email,
    phoneNumber: provider === 'sms' ? profile.providerSubject : null,
    status: 'active',
  });
  await repo.createIdentity({
    id: deps.ids.uuid(),
    userId,
    provider,
    providerSubject: profile.providerSubject,
    emailFromProvider: profile.email,
  });
  return { user, created: true };
}
