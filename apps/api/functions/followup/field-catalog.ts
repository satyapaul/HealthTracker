/**
 * The authoritative §7.2.1 follow-up field catalog (canonical keys), split into
 * the three JSONB groups the LLD §1.12 defines. This is the single source of
 * truth the handler/service/tests share so the catalog never drifts.
 *
 * All fields are OPTIONAL on a row (partial entry allowed, spec §7.2.2). The
 * only hard requirements on a row are pp_date and engagement_hospital_id, and —
 * on submit — at least one lab value (submit pseudocode, LLD §4.x).
 */
import { AppError } from './envelope';

/** Lab fields (§7.2.2) — numeric. `na_k` is text (e.g. "136/4.2"). */
export const LAB_NUMERIC_KEYS = [
  'hb',
  'tlc',
  'plt',
  'afp',
  'inr',
  'ptt',
  'bilirubin_total',
  'bilirubin_direct',
  'sgot',
  'sgpt',
  'alk_phos',
  'ggt',
  'albumin',
  'urea',
  'creatinine',
  'hba1c',
] as const;

/** `na_k` is stored as text because the paper form uses a combined "Na/K" cell. */
export const LAB_TEXT_KEYS = ['na_k'] as const;

/** Drug level fields (§7.2.3) — numeric serum levels. */
export const DRUG_LEVEL_KEYS = ['tac_level', 'evo_level'] as const;

/** Medication dose fields (§7.2.4) — dose notation strings, e.g. "4/4". */
export const DOSE_KEYS = ['neoral_tac', 'everolimus', 'aza_mpa', 'pred'] as const;

export type LabValues = Record<string, number | string>;
export type DrugLevels = Record<string, number>;
export type DoseValues = Record<string, string>;

const ALL_LAB_KEYS = new Set<string>([...LAB_NUMERIC_KEYS, ...LAB_TEXT_KEYS]);
const NUMERIC_LAB_KEYS = new Set<string>(LAB_NUMERIC_KEYS);
const TEXT_LAB_KEYS = new Set<string>(LAB_TEXT_KEYS);
const DRUG_LEVEL_SET = new Set<string>(DRUG_LEVEL_KEYS);
const DOSE_SET = new Set<string>(DOSE_KEYS);

function asRecord(raw: unknown, group: string): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('VALIDATION_ERROR', `Field '${group}' must be an object`, { field: group });
  }
  return raw as Record<string, unknown>;
}

/** Reject keys outside the catalog so typos/legacy labels fail loudly. */
function assertKnownKeys(obj: Record<string, unknown>, allowed: Set<string>, group: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new AppError('VALIDATION_ERROR', `Unknown ${group} field '${key}'`, {
        field: group,
        key,
      });
    }
  }
}

function toNumber(value: unknown, group: string, key: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError('VALIDATION_ERROR', `${group} field '${key}' must be numeric`, {
      field: group,
      key,
    });
  }
  return n;
}

/**
 * Validate + normalize lab_values. Numeric keys are coerced to numbers; na_k is
 * kept as a trimmed string. Null/absent entries are dropped (partial entry).
 */
export function parseLabValues(raw: unknown): LabValues {
  const obj = asRecord(raw, 'labValues');
  assertKnownKeys(obj, ALL_LAB_KEYS, 'labValues');
  const out: LabValues = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === '') continue;
    if (NUMERIC_LAB_KEYS.has(key)) {
      out[key] = toNumber(value, 'labValues', key);
    } else if (TEXT_LAB_KEYS.has(key)) {
      out[key] = String(value).trim();
    }
  }
  return out;
}

/** Validate + normalize drug_levels (all numeric). */
export function parseDrugLevels(raw: unknown): DrugLevels {
  const obj = asRecord(raw, 'drugLevels');
  assertKnownKeys(obj, DRUG_LEVEL_SET, 'drugLevels');
  const out: DrugLevels = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === '') continue;
    out[key] = toNumber(value, 'drugLevels', key);
  }
  return out;
}

/** Validate + normalize patient-reported doses (dose-notation strings). */
export function parseDoses(raw: unknown): DoseValues {
  const obj = asRecord(raw, 'doses');
  assertKnownKeys(obj, DOSE_SET, 'doses');
  const out: DoseValues = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string') {
      throw new AppError('VALIDATION_ERROR', `dose field '${key}' must be a string`, {
        field: 'doses',
        key,
      });
    }
    out[key] = value.trim();
  }
  return out;
}
