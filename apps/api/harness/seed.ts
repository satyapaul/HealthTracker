/**
 * Shared fixtures for the local harness. Seeds each domain's in-memory fake
 * with a CONSISTENT set of ids so the smoke tests + the web UI can act as the
 * same admin/doctor/patient/hospital across domains.
 *
 * Fixture ids (stable, referenced by the curl scripts + the SPA):
 *   admin   user:  admin-1
 *   doctor  user:  doctor-1   (primary doctor + assigned to patient-1)
 *   patient id:    patient-1  (its linked user: user-patient-1)
 *   hospital:      hosp-1     "Test Hospital" (doctor-1 affiliated + primary)
 *
 * Follow-up rows for patient-1 (so patient history + the doctor flow chart +
 * the response-detail screen all populate):
 *   fur-reviewed-1  2026-06-13  reviewed  (has a doctor response + dose changes)
 *   fur-reviewed-2  2026-06-19  reviewed
 *   fur-pending-1   2026-06-22  pending
 */
import type { makeBundle as patientBundle } from '../functions/patient/__tests__/fakes';
import type { makeBundle as followupBundle } from '../functions/followup/__tests__/fakes';
import type { makeBundle as doseBundle } from '../functions/dose/__tests__/fakes';
import type { makeBundle as hospitalBundle } from '../functions/hospital/__tests__/fakes';
import type { makeBundle as adminBundle } from '../functions/admin/__tests__/fakes';
import type { makeBundle as chatBundle } from '../functions/chat/__tests__/fakes';
// Auth fakes: import ONLY the vitest-free classes/values (the fake's own
// makeBundle pulls in `vi` spies, which can't be require()d in the compiled
// CommonJS harness — so the harness assembles the auth deps itself below).
import {
  FakeDb as AuthFakeDb,
  FakeRedis as AuthFakeRedis,
  FakeAudit as AuthFakeAudit,
  FakeIds as AuthFakeIds,
  FixedClock as AuthFixedClock,
  fakeHasher,
  noopLogger as authNoopLogger,
  defaultConfig as authDefaultConfig,
} from '../functions/auth/__tests__/fakes-core';
import type { AuthDeps } from '../functions/auth/deps';
import type { GoogleOAuthPort, XOAuthPort } from '../functions/auth/ports/oauth';
import type { SmsGateway } from '../functions/auth/ports/sms';

export interface AuthFixture {
  deps: AuthDeps;
  db: AuthFakeDb;
  redis: AuthFakeRedis;
  ids: AuthFakeIds;
}

export interface Fixture {
  patient: ReturnType<typeof patientBundle>;
  followup: ReturnType<typeof followupBundle>;
  dose: ReturnType<typeof doseBundle>;
  hospital: ReturnType<typeof hospitalBundle>;
  admin: ReturnType<typeof adminBundle>;
  chat: ReturnType<typeof chatBundle>;
}

export const IDS = {
  adminUser: 'admin-1',
  doctorUser: 'doctor-1',
  patientId: 'patient-1',
  patientUser: 'user-patient-1',
  hospitalId: 'hosp-1',
  hospitalName: 'Test Hospital',
} as const;

const NOW = '2026-09-01T00:00:00.000Z';

/** A follow-up row for the followup fake store, with sensible defaults. */
function followUpRow(overrides: {
  id: string;
  ppDate: string;
  status: 'draft' | 'pending' | 'reviewed';
  labValues?: Record<string, number | string>;
  drugLevels?: Record<string, number>;
  patientReportedDoses?: Record<string, string>;
  doctorPrescribedDoses?: Record<string, string> | null;
  weightKg?: number | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}) {
  const submitted = overrides.status !== 'draft';
  return {
    id: overrides.id,
    patientId: IDS.patientId,
    ppDate: overrides.ppDate,
    status: overrides.status,
    labValues: overrides.labValues ?? {},
    drugLevels: overrides.drugLevels ?? {},
    patientReportedDoses: overrides.patientReportedDoses ?? {},
    doctorPrescribedDoses: overrides.doctorPrescribedDoses ?? null,
    weightKg: overrides.weightKg ?? null,
    notes: null,
    engagementHospitalId: IDS.hospitalId,
    engagementHospitalName: IDS.hospitalName,
    submittedAt: submitted ? `${overrides.ppDate}T09:00:00.000Z` : null,
    reviewedAt: overrides.reviewedAt ?? null,
    reviewedBy: overrides.reviewedBy ?? null,
    createdAt: `${overrides.ppDate}T08:00:00.000Z`,
    updatedAt: `${overrides.ppDate}T09:00:00.000Z`,
  };
}

export function seedAll(bundles: Fixture): Fixture {
  // ── patient domain: a chart for patient-1, doctor-1 assigned + an engagement
  bundles.patient.db.rows.set(IDS.patientId, {
    id: IDS.patientId,
    name: 'Raghavendra',
    ageYears: 42,
    sex: 'M',
    maxId: 'SHMS.750590',
    photoUrl: null,
    dateOfOperation: '2026-05-26',
    diagnosis: 'DCLD',
    histopathology: 'Biliary Cirrhosis',
    anastomosisType: 'Roux-en-Y',
    contactEmail: 'doc@example.com',
    phoneNumber: null,
    whatsappNumber: null,
    reminderPreferences: { smsEnabled: true, whatsappEnabled: true, timezone: 'Asia/Kolkata' },
    reminderOptOut: false,
    procedureHospitalId: IDS.hospitalId,
    defaultFollowupHospitalId: IDS.hospitalId,
    primaryDoctorId: IDS.doctorUser,
    createdAt: NOW,
    updatedAt: NOW,
  });
  bundles.patient.db.assign(IDS.doctorUser, IDS.patientId);
  bundles.patient.db.addEngagement(IDS.patientId, IDS.hospitalId, true);

  // ── followup domain: a history of rows for patient-1 + doctor-1 assigned so
  //    both the patient history and the doctor flow chart populate.
  bundles.followup.db.rows.set(
    'fur-reviewed-1',
    followUpRow({
      id: 'fur-reviewed-1',
      ppDate: '2026-06-13',
      status: 'reviewed',
      labValues: { hb: 10.2, tlc: 4.7, plt: 226, bilirubin_total: 0.8, sgot: 35, creatinine: 0.6 },
      drugLevels: { tac_level: 12.2 },
      patientReportedDoses: { neoral_tac: '4/4', aza_mpa: '1/1', pred: '20' },
      doctorPrescribedDoses: { neoral_tac: '4/4', aza_mpa: '0.5/0.5', pred: '20' },
      weightKg: 54,
      reviewedAt: '2026-06-14T10:00:00.000Z',
      reviewedBy: IDS.doctorUser,
    })
  );
  bundles.followup.db.rows.set(
    'fur-reviewed-2',
    followUpRow({
      id: 'fur-reviewed-2',
      ppDate: '2026-06-19',
      status: 'reviewed',
      labValues: { hb: 10.2, tlc: 4.7, plt: 226, bilirubin_total: 0.8, sgot: 25, albumin: 2.9 },
      drugLevels: { tac_level: 1.04 },
      patientReportedDoses: { neoral_tac: '4/4', pred: '20' },
      weightKg: 54,
      reviewedAt: '2026-06-20T10:00:00.000Z',
      reviewedBy: IDS.doctorUser,
    })
  );
  bundles.followup.db.rows.set(
    'fur-pending-1',
    followUpRow({
      id: 'fur-pending-1',
      ppDate: '2026-06-22',
      status: 'pending',
      labValues: { hb: 10.4, tlc: 5.2, plt: 311, bilirubin_total: 0.7, sgot: 95, albumin: 2.9 },
      drugLevels: { tac_level: 15.3 },
      patientReportedDoses: { neoral_tac: '4/4', pred: '20' },
      weightKg: 55,
    })
  );
  bundles.followup.db.assign(IDS.doctorUser, IDS.patientId);

  // ── dose domain: the reviewed row + a doctor response + dose-change history
  //    so the patient response-detail screen populates.
  bundles.dose.db.seedRow({
    id: 'fur-reviewed-1',
    patientId: IDS.patientId,
    status: 'reviewed',
    patientReportedDoses: { neoral_tac: '4/4', aza_mpa: '1/1', pred: '20' },
    doctorPrescribedDoses: { neoral_tac: '4/4', aza_mpa: '0.5/0.5', pred: '20' },
  });
  bundles.dose.db.assign(IDS.doctorUser, IDS.patientId);
  bundles.dose.db.responses.set('fur-reviewed-1', {
    id: 'resp-1',
    followUpRowId: 'fur-reviewed-1',
    doctorId: IDS.doctorUser,
    additionalTests: ['Liver Ultrasound', { name: 'CMV PCR (Blood test)' }],
    additionalMedications: null,
    clinicalNotes:
      'Continue current Tac dose. Monitor creatinine at next visit. Reduce Aza as levels are stable. Reach out via chat if you experience any abdominal pain.',
    nextFollowupIntervalDays: 14,
    sentAt: '2026-06-14T10:15:00.000Z',
  });
  bundles.dose.db.doseChanges.push({
    id: 'dc-1',
    followUpRowId: 'fur-reviewed-1',
    fieldName: 'aza_mpa',
    oldValue: '1/1',
    newValue: '0.5/0.5',
    changedBy: IDS.doctorUser,
    changedAt: '2026-06-14T10:10:00.000Z',
    reason: 'Levels stable; reduce to lower maintenance dose.',
  });

  // ── hospital domain: hosp-1 active, doctor-1 affiliated + patient-1 primary
  bundles.hospital.db.addHospital({
    id: IDS.hospitalId,
    hospitalCode: 'SHMS',
    hospitalName: IDS.hospitalName,
    hospitalType: 'general',
    city: 'New Delhi',
    logoUrl: null,
    status: 'active',
  });
  bundles.hospital.db.affiliate(IDS.doctorUser, IDS.hospitalId);
  bundles.hospital.db.primaryDoctor.set(IDS.patientId, IDS.doctorUser);
  bundles.hospital.db.assign(IDS.doctorUser, IDS.patientId);
  bundles.hospital.db.affiliationViews.set(IDS.doctorUser, [
    {
      affiliationId: 'aff-1',
      hospital: { id: IDS.hospitalId, hospitalName: IDS.hospitalName, hospitalCode: 'SHMS' },
      roleAtHospital: 'Transplant Surgeon',
      isPrimary: true,
      status: 'active',
    },
  ]);

  // ── admin domain: a doctor user exists so affiliation creation works
  bundles.admin.db.users.set(IDS.doctorUser, 'doctor');

  // ── chat domain: a care-team thread for patient-1, doctor-1 is primary
  bundles.chat.db.seedThread({
    id: 'thread-1',
    patientId: IDS.patientId,
    threadType: 'patient_care_team',
    memberUserIds: [IDS.patientUser, IDS.doctorUser],
  });
  bundles.chat.db.primaryDoctor.set(IDS.patientId, IDS.doctorUser);

  return bundles;
}

/**
 * Seed the auth fake so a REAL OTP login works against the harness and maps to
 * the same fixtures the other domains use. Two phone numbers are pre-registered
 * as existing users (so OTP verify loads them instead of minting a fresh
 * patient with no patient link):
 *
 *   +919999900001 -> user-patient-1  (role patient, linkedPatientId patient-1)
 *   +919999900002 -> doctor-1        (role doctor,  no patient link)
 *
 * The dev OTP code is fixed at 424242 (the fake SMS gateway just records the
 * message; the harness logs the code so a human can complete login). A brand-
 * new phone number still works via find-or-create, but yields a patient with
 * no linked chart.
 */
export const DEV_OTP = '424242';

export const AUTH_PHONES = {
  patient: '+919999900001',
  doctor: '+919999900002',
} as const;

/** Plain (non-spy) OAuth/SMS port stubs — the harness doesn't exercise the
 *  OAuth round-trip, and SMS "send" just no-ops (the dev OTP is fixed). */
function stubGoogle(): GoogleOAuthPort {
  return {
    exchangeAndVerify: async () => ({
      providerSubject: 'google-sub-dev',
      email: 'dev@example.com',
      emailVerified: true,
      displayName: 'Dev Google User',
    }),
  };
}
function stubX(): XOAuthPort {
  return {
    exchangeAndVerify: async () => ({
      providerSubject: 'x-sub-dev',
      email: null,
      emailVerified: false,
      displayName: 'Dev X User',
    }),
  };
}
function stubSms(): SmsGateway {
  return { send: async () => {} };
}

/**
 * Assemble the auth deps from the vitest-free fakes and seed them. Returns the
 * bundle (deps + db + redis + ids) the harness wires to the auth handler and
 * reads back for session-token resolution.
 */
export function makeAuthFixture(): AuthFixture {
  const db = new AuthFakeDb();
  const redis = new AuthFakeRedis();
  const audit = new AuthFakeAudit();
  const ids = new AuthFakeIds();
  const clock = new AuthFixedClock(new Date());
  const deps: AuthDeps = {
    db,
    redis,
    google: stubGoogle(),
    x: stubX(),
    sms: stubSms(),
    audit,
    hasher: fakeHasher,
    clock,
    ids,
    logger: authNoopLogger,
    config: { ...authDefaultConfig },
  };
  const auth: AuthFixture = { deps, db, redis, ids };

  // Fixed, well-known OTP for every challenge in dev.
  auth.ids.otpQueue = [DEV_OTP];

  // Pre-register the patient user linked to patient-1.
  auth.db.users.set('user-patient-1', {
    id: 'user-patient-1',
    role: 'patient',
    displayName: 'Raghavendra',
    email: null,
    phoneNumber: AUTH_PHONES.patient,
    status: 'active',
    linkedPatientId: 'patient-1',
  });
  auth.db.identities.push({
    id: 'ident-patient-1',
    userId: 'user-patient-1',
    provider: 'sms',
    providerSubject: AUTH_PHONES.patient,
  });

  // Pre-register the doctor user (no patient link).
  auth.db.users.set('doctor-1', {
    id: 'doctor-1',
    role: 'doctor',
    displayName: 'Dr. Rajesh Dey',
    email: null,
    phoneNumber: AUTH_PHONES.doctor,
    status: 'active',
    linkedPatientId: null,
  });
  auth.db.identities.push({
    id: 'ident-doctor-1',
    userId: 'doctor-1',
    provider: 'sms',
    providerSubject: AUTH_PHONES.doctor,
  });

  return auth;
}
