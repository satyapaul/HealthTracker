import type { CreateFollowUpBody } from '../../api/endpoints';
import { ALL_LAB_FIELDS, DOSE_FIELDS, DRUG_LEVEL_FIELDS } from './field-catalog';

/**
 * Wizard form state. Values are kept as raw strings while editing (so partial
 * input and clearing work), then normalized into the typed request body on
 * submit. AM/PM doses are held as two strings and combined into the dose
 * notation ("4/4") the backend expects.
 */
export interface WizardState {
  ppDate: string;
  engagementHospitalId: string | null;
  engagementHospitalName: string | null;
  /** labValues + drugLevels raw string values keyed by field key. */
  labs: Record<string, string>;
  drugLevels: Record<string, string>;
  /** Single-value doses (aza_mpa, pred) keyed by field key. */
  doses: Record<string, string>;
  /** AM/PM doses keyed by field key -> { am, pm }. */
  dosesAmPm: Record<string, { am: string; pm: string }>;
  weightKg: string;
  notes: string;
  /** Attachment is a client-only placeholder until the presign flow is wired. */
  attachedFileName: string | null;
}

export function emptyWizardState(ppDate: string): WizardState {
  return {
    ppDate,
    engagementHospitalId: null,
    engagementHospitalName: null,
    labs: {},
    drugLevels: {},
    doses: {},
    dosesAmPm: {},
    weightKg: '',
    notes: '',
    attachedFileName: null,
  };
}

/** Combine an AM/PM pair into the "am/pm" dose notation, or '' if both empty. */
export function combineAmPm(pair: { am: string; pm: string } | undefined): string {
  if (!pair) return '';
  const am = pair.am.trim();
  const pm = pair.pm.trim();
  if (!am && !pm) return '';
  return `${am || '0'}/${pm || '0'}`;
}

/** Build the typed POST body from wizard state, dropping empty values. */
export function toCreateBody(s: WizardState): CreateFollowUpBody {
  const labValues: Record<string, number | string> = {};
  for (const f of ALL_LAB_FIELDS) {
    const raw = s.labs[f.key]?.trim();
    if (!raw) continue;
    labValues[f.key] = f.kind === 'labText' ? raw : Number(raw);
  }

  const drugLevels: Record<string, number> = {};
  for (const f of DRUG_LEVEL_FIELDS) {
    const raw = s.drugLevels[f.key]?.trim();
    if (!raw) continue;
    drugLevels[f.key] = Number(raw);
  }

  const patientReportedDoses: Record<string, string> = {};
  for (const f of DOSE_FIELDS) {
    const value = f.amPm ? combineAmPm(s.dosesAmPm[f.key]) : (s.doses[f.key]?.trim() ?? '');
    if (value) patientReportedDoses[f.key] = value;
  }

  const body: CreateFollowUpBody = {
    ppDate: s.ppDate,
    engagementHospitalId: s.engagementHospitalId ?? '',
    labValues,
    drugLevels,
    patientReportedDoses,
  };
  const weight = s.weightKg.trim();
  if (weight) body.weightKg = Number(weight);
  const notes = s.notes.trim();
  if (notes) body.notes = notes;
  return body;
}

/** True when at least one lab value is present (backend requires this on submit). */
export function hasAnyLab(s: WizardState): boolean {
  return ALL_LAB_FIELDS.some((f) => (s.labs[f.key]?.trim() ?? '') !== '');
}
