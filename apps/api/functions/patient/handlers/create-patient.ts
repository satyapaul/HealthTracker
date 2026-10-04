/**
 * POST /patients — onboard a new patient chart (admin only).
 * 201 with the created chart on success.
 */
import type { PatientDeps } from '../deps';
import type { PatientRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import {
  parseJsonBody,
  requirePrincipal,
  requireString,
  optionalString,
  optionalNumber,
  optionalBoolean,
} from '../http';
import { createPatient, type CreatePatientCommand } from '../services/patient-service';
import { parseReminderPreferences } from './parse-reminder-prefs';

export async function handleCreatePatient(
  deps: PatientDeps,
  req: PatientRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const body = parseJsonBody(req);

  const cmd: CreatePatientCommand = {
    name: requireString(body, 'name'),
    maxId: requireString(body, 'maxId'),
    ageYears: optionalNumber(body, 'ageYears'),
    sex: optionalString(body, 'sex'),
    photoUrl: optionalString(body, 'photoUrl'),
    dateOfOperation: optionalString(body, 'dateOfOperation'),
    diagnosis: optionalString(body, 'diagnosis'),
    histopathology: optionalString(body, 'histopathology'),
    anastomosisType: optionalString(body, 'anastomosisType'),
    contactEmail: optionalString(body, 'contactEmail'),
    phoneNumber: optionalString(body, 'phoneNumber'),
    whatsappNumber: optionalString(body, 'whatsappNumber'),
    reminderPreferences: parseReminderPreferences(body.reminderPreferences),
    reminderOptOut: optionalBoolean(body, 'reminderOptOut'),
    procedureHospitalId: optionalString(body, 'procedureHospitalId'),
    defaultFollowupHospitalId: optionalString(body, 'defaultFollowupHospitalId'),
    primaryDoctorId: optionalString(body, 'primaryDoctorId'),
  };

  const chart = await createPatient(deps, principal, cmd);
  return respondOk(chart, 201);
}
