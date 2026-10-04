/**
 * Shared fixtures for the local harness. Seeds each domain's in-memory fake
 * with a CONSISTENT set of ids so the smoke tests can act as the same
 * admin/doctor/patient/hospital across domains.
 *
 * Fixture ids (stable, referenced by the curl scripts):
 *   admin   user:  admin-1
 *   doctor  user:  doctor-1   (primary doctor + assigned to patient-1)
 *   patient id:    patient-1  (its linked user: user-patient-1)
 *   hospital:      hosp-1     "Test Hospital" (doctor-1 affiliated + primary)
 */
import type { makeBundle as patientBundle } from '../functions/patient/__tests__/fakes';
import type { makeBundle as followupBundle } from '../functions/followup/__tests__/fakes';
import type { makeBundle as doseBundle } from '../functions/dose/__tests__/fakes';
import type { makeBundle as hospitalBundle } from '../functions/hospital/__tests__/fakes';
import type { makeBundle as adminBundle } from '../functions/admin/__tests__/fakes';
import type { makeBundle as chatBundle } from '../functions/chat/__tests__/fakes';

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

export function seedAll(bundles: Fixture): Fixture {
  // ── patient domain: a chart for patient-1, doctor-1 assigned + an engagement
  bundles.patient.db.rows.set(IDS.patientId, {
    id: IDS.patientId,
    name: 'Test Patient',
    ageYears: 4.5,
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

  // ── followup domain: FakeHospital allowlist already has hosp-1 "Test
  // Hospital"; nothing else needed (patients create their own rows via the API).

  // ── dose domain: a pending row for patient-1, doctor-1 assigned
  bundles.dose.db.seedRow({
    id: 'fur-seed-1',
    patientId: IDS.patientId,
    status: 'pending',
    patientReportedDoses: { neoral_tac: '2/2', pred: '5' },
  });
  bundles.dose.db.assign(IDS.doctorUser, IDS.patientId);

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
