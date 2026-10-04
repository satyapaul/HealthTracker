/**
 * PATCH /patients/{id} — update a patient chart's header fields.
 * patient/caregiver may update their own chart (RLS enforces the row); admin
 * may update any. Only the supplied fields change.
 */
import type { PatientDeps } from '../deps';
import type { PatientRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import {
  parseJsonBody,
  requirePrincipal,
  optionalString,
  optionalNumber,
  optionalBoolean,
} from '../http';
import { updatePatient, type UpdatePatientCommand } from '../services/patient-service';
import { parseReminderPreferences } from './parse-reminder-prefs';

export async function handleUpdatePatient(
  deps: PatientDeps,
  req: PatientRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);

  const cmd: UpdatePatientCommand = {
    name: optionalString(body, 'name'),
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

  const chart = await updatePatient(deps, principal, id.trim(), cmd);
  return respondOk(chart);
}
