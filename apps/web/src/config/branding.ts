/**
 * Config-driven branding (product steering 🎨).
 *
 * The product NAME is undecided and MUST NOT be hardcoded in business logic.
 * App name, logo, colors, and copy are driven by this config and can change
 * without touching components. At build/deploy time the name can be overridden
 * via the VITE_APP_NAME env var; the default below is a placeholder only
 * (a "RecoverEase" mock exists but is NOT the final brand).
 */
export interface Branding {
  /** Display name shown in chrome (document title, welcome copy). Placeholder-only default. */
  appName: string;
  /** Short tagline under the welcome header. */
  tagline: string;
  /** Optional logo URL; when null, the UI falls back to a text/monogram mark. */
  logoUrl: string | null;
  /** Legal links surfaced on the auth screen. */
  legal: {
    termsUrl: string;
    privacyUrl: string;
  };
}

// NOTE: "RecoverEase" is a non-final placeholder from the CX mock, not the
// chosen product name. Override with VITE_APP_NAME; do not branch on this value.
const DEFAULT_APP_NAME = 'RecoverEase';

export const branding: Branding = {
  appName: import.meta.env.VITE_APP_NAME?.trim() || DEFAULT_APP_NAME,
  tagline: 'Secure post-operative follow-up',
  logoUrl: null,
  legal: {
    termsUrl: '#/legal/terms',
    privacyUrl: '#/legal/privacy',
  },
};

/** First grapheme of the app name, for a monogram fallback when no logo is set. */
export function brandMonogram(name: string = branding.appName): string {
  return name.trim().charAt(0).toUpperCase() || '•';
}
