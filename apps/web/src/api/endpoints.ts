/**
 * Thin, typed endpoint wrappers over the API client. One function per backend
 * route the SPA calls; keeps components free of path/shape details.
 */
import { api } from './client';
import type {
  DoctorResponse,
  DoseChange,
  FollowUpRow,
  HospitalSummary,
  PatientChart,
} from './types';

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

/** Request body for creating a draft follow-up row (POST /followup/rows). */
export interface CreateFollowUpBody {
  ppDate: string;
  /** Required (v1.7): every row is tied to a hospital engagement. */
  engagementHospitalId: string;
  labValues: Record<string, number | string>;
  drugLevels: Record<string, number>;
  patientReportedDoses: Record<string, string>;
  weightKg?: number;
  notes?: string;
}

export const followupApi = {
  /** Create a draft row (status 'draft'). */
  createDraft: (body: CreateFollowUpBody) => api.post<FollowUpRow>('/followup/rows', body),
  /** Submit a draft for doctor review (status -> 'pending'). */
  submit: (rowId: string) => api.put<FollowUpRow>(`/followup/rows/${rowId}/submit`),
  /** Read a single row. */
  getRow: (rowId: string) => api.get<FollowUpRow>(`/followup/rows/${rowId}`),
};

// ── Doctor response + dose changes (WP 2.3) ─────────────────────────────────
export const doseApi = {
  getResponse: (rowId: string) => api.get<DoctorResponse>(`/followup/rows/${rowId}/response`),
  getDoseChanges: (rowId: string) =>
    api.get<{ doseChanges: DoseChange[] }>(`/followup/rows/${rowId}/dose-changes`),
};

// ── Doctor dashboard (WP 3.4 / D-13) ────────────────────────────────────────
export interface DoctorPatientEntry {
  patient: PatientChart;
  pendingSubmissionCount: number;
  hasPending: boolean;
}

export const doctorApi = {
  /** Assigned patients + pending badges; optional hospital filter (D-13). */
  listPatients: (hospitalId?: string) =>
    api.get<{ patients: DoctorPatientEntry[] }>('/patients', {
      query: hospitalId ? { hospital_id: hospitalId } : undefined,
    }),
};

// ── Hospitals (WP 3.1 / 3.3) ────────────────────────────────────────────────
export const hospitalApi = {
  /** Patient picker: the primary doctor's active affiliations + Virtual (pinned). */
  forPatient: (patientId: string) =>
    api.get<{ hospitals: HospitalSummary[] }>('/hospitals', { query: { forPatient: patientId } }),
};
