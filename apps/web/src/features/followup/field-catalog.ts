/**
 * UI field catalog for the follow-up wizard. The KEYS here must match the
 * backend §7.2.1 catalog exactly (apps/api/functions/followup/field-catalog.ts)
 * — labs, drug levels, and doses are sent back under those keys. Labels/units/
 * grouping are presentation concerns derived from the CX mocks + spec.
 *
 * `kind` controls the input + which request bucket the value goes into:
 *   - 'labNumeric'  -> labValues[key] as number
 *   - 'labText'     -> labValues[key] as string (na_k = "136/4.2")
 *   - 'drugLevel'   -> drugLevels[key] as number
 *   - 'dose'        -> patientReportedDoses[key] as string ("4/4", "5")
 */
export type FieldKind = 'labNumeric' | 'labText' | 'drugLevel' | 'dose';

export interface FieldDef {
  key: string;
  label: string;
  unit?: string;
  kind: FieldKind;
  /** Dose fields use an AM/PM split in the mock (e.g. Neoral/Tac "4 AM | 4 PM"). */
  amPm?: boolean;
  placeholder?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldDef[];
}

/** Step 1 — Labs, grouped as in the lab-values-entry mock. */
export const LAB_GROUPS: FieldGroup[] = [
  {
    title: 'Hematology',
    fields: [
      { key: 'hb', label: 'Hemoglobin (Hb)', unit: 'g/dL', kind: 'labNumeric' },
      { key: 'tlc', label: 'Total Leukocyte Count (TLC)', unit: '10³/µL', kind: 'labNumeric' },
      { key: 'plt', label: 'Platelets', unit: '10³/µL', kind: 'labNumeric' },
    ],
  },
  {
    title: 'Liver Function',
    fields: [
      { key: 'bilirubin_total', label: 'Bilirubin Total', unit: 'mg/dL', kind: 'labNumeric' },
      { key: 'bilirubin_direct', label: 'Bilirubin Direct', unit: 'mg/dL', kind: 'labNumeric' },
      { key: 'sgot', label: 'SGOT / AST', unit: 'U/L', kind: 'labNumeric' },
      { key: 'sgpt', label: 'SGPT / ALT', unit: 'U/L', kind: 'labNumeric' },
      { key: 'alk_phos', label: 'Alk Phos', unit: 'U/L', kind: 'labNumeric' },
      { key: 'ggt', label: 'GGT', unit: 'U/L', kind: 'labNumeric' },
      { key: 'albumin', label: 'Albumin', unit: 'g/dL', kind: 'labNumeric' },
      { key: 'afp', label: 'AFP', unit: 'ng/mL', kind: 'labNumeric' },
    ],
  },
  {
    title: 'Renal & Electrolytes',
    fields: [
      { key: 'urea', label: 'Urea', unit: 'mg/dL', kind: 'labNumeric' },
      { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', kind: 'labNumeric' },
      { key: 'na_k', label: 'Na / K', kind: 'labText', placeholder: 'e.g. 138 / 4.2' },
    ],
  },
  {
    title: 'Coagulation & Metabolic',
    fields: [
      { key: 'inr', label: 'INR', kind: 'labNumeric' },
      { key: 'ptt', label: 'PTT', unit: 's', kind: 'labNumeric' },
      { key: 'hba1c', label: 'HbA1c', unit: '%', kind: 'labNumeric' },
    ],
  },
];

/** Step 2 — Drug levels (serum), from the medications mock. */
export const DRUG_LEVEL_FIELDS: FieldDef[] = [
  { key: 'tac_level', label: 'Tacrolimus Level', unit: 'ng/mL', kind: 'drugLevel' },
  { key: 'evo_level', label: 'Everolimus Level', unit: 'ng/mL', kind: 'drugLevel' },
];

/** Step 2 — Current daily doses. Neoral/Tac + Everolimus split AM/PM. */
export const DOSE_FIELDS: FieldDef[] = [
  { key: 'neoral_tac', label: 'Neoral / Tacrolimus', kind: 'dose', amPm: true },
  { key: 'everolimus', label: 'Everolimus', kind: 'dose', amPm: true },
  { key: 'aza_mpa', label: 'Aza / MPA', unit: 'mg', kind: 'dose' },
  { key: 'pred', label: 'Prednisolone', unit: 'mg', kind: 'dose' },
];

/** All lab fields flat (for the review step summary + lookups). */
export const ALL_LAB_FIELDS: FieldDef[] = LAB_GROUPS.flatMap((g) => g.fields);
