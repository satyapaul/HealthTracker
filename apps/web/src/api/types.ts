/**
 * Shared API DTOs mirroring the backend response shapes (apps/api/functions/*).
 * Field keys use the canonical camelCase the handlers emit.
 */

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

export interface PatientChart {
  id: string;
  name: string;
  ageYears: number;
  sex: string;
  maxId: string;
  photoUrl: string | null;
  dateOfOperation: string;
  diagnosis: string;
  histopathology: string;
  anastomosisType: string;
  contactEmail: string | null;
  phoneNumber: string | null;
  whatsappNumber: string | null;
  procedureHospitalId: string | null;
  defaultFollowupHospitalId: string | null;
  primaryDoctorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FollowUpStatus = 'draft' | 'pending' | 'reviewed';

export interface FollowUpRow {
  id: string;
  patientId: string;
  ppDate: string;
  status: FollowUpStatus;
  labValues: Record<string, number | string | null>;
  drugLevels: Record<string, number | string | null>;
  patientReportedDoses: Record<string, string>;
  doctorPrescribedDoses: Record<string, string> | null;
  weightKg: number | null;
  notes: string | null;
  engagementHospitalId: string;
  engagementHospitalName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorResponse {
  id: string;
  followUpRowId: string;
  doctorId: string;
  additionalTests: unknown[];
  additionalMedications: string | null;
  clinicalNotes: string | null;
  nextFollowupIntervalDays: number | null;
  sentAt: string;
}

export interface DoseChange {
  id: string;
  followUpRowId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

export interface HospitalSummary {
  id: string;
  hospitalCode: string;
  hospitalName: string;
  hospitalType: string;
  city: string | null;
  logoUrl: string | null;
  status: string;
  /** The picker pins the Virtual Hospital to the top. */
  pinned?: boolean;
}
