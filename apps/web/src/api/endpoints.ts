/**
 * Thin, typed endpoint wrappers over the API client. One function per backend
 * route the SPA calls; keeps components free of path/shape details.
 */
import { api } from './client';
import type { FollowUpRow, HospitalSummary, PatientChart } from './types';

// ── Auth (SPEC §12 / WP 1.1) ────────────────────────────────────────────────
export interface OtpRequestResult {
  challengeId: string;
  /** Seconds until the code expires. */
  expiresInSec: number;
}

export interface SessionResult {
  token: string;
  role: 'patient' | 'caregiver' | 'doctor' | 'admin';
  patientId?: string;
}

export const authApi = {
  /** Start an SMS OTP sign-in; returns a challenge to verify. */
  requestOtp: (phoneE164: string) =>
    api.post<OtpRequestResult>('/auth/otp/request', { phone: phoneE164 }, { auth: false }),
  /** Verify an OTP code and establish a session. */
  verifyOtp: (challengeId: string, code: string) =>
    api.post<SessionResult>('/auth/otp/verify', { challengeId, code }, { auth: false }),
};

/** OAuth providers shown on the welcome screen (redirect-based). */
export type OAuthProvider = 'google' | 'apple' | 'facebook';

// ── Patient chart + follow-up (WP 2.1 / 2.2 / 3.3) ──────────────────────────
export const patientApi = {
  getChart: (patientId: string) => api.get<PatientChart>(`/patients/${patientId}`),
  listRows: () => api.get<{ rows: FollowUpRow[] }>('/followup/rows'),
};

// ── Hospitals (WP 3.1 / 3.3) ────────────────────────────────────────────────
export const hospitalApi = {
  /** Patient picker: the primary doctor's active affiliations + Virtual (pinned). */
  forPatient: (patientId: string) =>
    api.get<{ hospitals: HospitalSummary[] }>('/hospitals', { query: { forPatient: patientId } }),
};
