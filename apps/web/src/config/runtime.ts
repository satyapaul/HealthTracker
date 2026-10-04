/**
 * Runtime configuration. The API base URL is injected from VITE_API_BASE_URL:
 *   - unset / empty  -> SAME-ORIGIN (relative URLs). This is the default and
 *     is what the single-process demo deploy uses (the harness serves both the
 *     SPA and the API from one origin), and what a real deployment behind the
 *     same domain would use.
 *   - a full URL     -> target that host (e.g. the local harness on :4000 via
 *     apps/web/.env.local, or a real API Gateway URL).
 */
export interface RuntimeConfig {
  /** '' means same-origin (relative requests). */
  apiBaseUrl: string;
}

export const runtimeConfig: RuntimeConfig = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, ''),
};

/**
 * Demo mode (VITE_DEMO_MODE=true at build): the app runs against the seeded
 * in-memory harness with no real backend, so the welcome screen surfaces the
 * well-known demo phone numbers + OTP code. Off for any real build.
 */
export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
