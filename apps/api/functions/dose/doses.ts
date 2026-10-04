/**
 * Dose field catalog + parsing for the dose (review) domain.
 *
 * The canonical medication-dose keys are the same four the followup domain
 * defines (spec §7.2.4). We re-declare them here as the authoritative set for
 * the dose domain to keep this function self-contained (one Lambda bundle); the
 * values must stay in sync with followup/field-catalog.ts DOSE_KEYS.
 */
import { AppError } from './envelope';

/** Medication dose fields (§7.2.4) — dose notation strings, e.g. "4/4". */
export const DOSE_KEYS = ['neoral_tac', 'everolimus', 'aza_mpa', 'pred'] as const;

export type DoseValues = Record<string, string>;

const DOSE_SET = new Set<string>(DOSE_KEYS);

/**
 * Validate + normalize a doctor_prescribed_doses object. Only known dose keys
 * are allowed; each value must be a non-empty dose-notation string. Absent/null
 * entries are dropped (a doctor may prescribe a subset).
 */
export function parseDoses(raw: unknown, field = 'doctorPrescribedDoses'): DoseValues {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be an object`, { field });
  }
  const obj = raw as Record<string, unknown>;
  const out: DoseValues = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!DOSE_SET.has(key)) {
      throw new AppError('VALIDATION_ERROR', `Unknown dose field '${key}'`, { field, key });
    }
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string') {
      throw new AppError('VALIDATION_ERROR', `Dose field '${key}' must be a string`, {
        field,
        key,
      });
    }
    out[key] = value.trim();
  }
  return out;
}

/** One field-level dose change (patient-reported/prior -> doctor-prescribed). */
export interface DoseDiff {
  fieldName: string;
  oldValue: string | null;
  newValue: string;
}

/**
 * Compute the per-field dose changes between what the doctor is prescribing and
 * the prior values (patient-reported, or an earlier prescription). A change is
 * recorded only where the new value differs from the old. The baseline for each
 * key is the prior prescribed value if present, else the patient-reported value
 * (so re-review history chains correctly).
 */
export function diffDoses(
  prescribed: DoseValues,
  patientReported: DoseValues,
  priorPrescribed: DoseValues | null
): DoseDiff[] {
  const diffs: DoseDiff[] = [];
  for (const key of DOSE_KEYS) {
    const newValue = prescribed[key];
    if (newValue === undefined) continue; // doctor did not prescribe this field
    const baseline = priorPrescribed?.[key] ?? patientReported[key] ?? null;
    if (baseline !== newValue) {
      diffs.push({ fieldName: key, oldValue: baseline, newValue });
    }
  }
  return diffs;
}
