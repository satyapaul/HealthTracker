import type { ClinicalStatus } from '../../ui';

/**
 * Reference ranges for the post-op flow chart (doctor dashboard legend:
 * High / Warn / Normal). Ranges are indicative defaults drawn from the CX mock
 * (e.g. Hb 13.5–17.5, Tac target 8–12) and are a presentation aid only — they
 * are NOT a clinical source of truth and must be confirmed against lab-specific
 * reference intervals before any clinical use. A warn band flanks the normal
 * range so borderline values read amber rather than red.
 */
export interface RefRange {
  low: number;
  high: number;
  /** Fraction of the band width used as the amber (warn) margin. Default 10%. */
  warnFraction?: number;
  /** Display string shown under the parameter label (e.g. "13.5-17.5"). */
  display: string;
}

/** Keyed by the §7.2.1 field key. Only parameters with a known range are coded. */
export const REFERENCE_RANGES: Record<string, RefRange> = {
  hb: { low: 13.5, high: 17.5, display: '13.5-17.5' },
  tlc: { low: 4.0, high: 11.0, display: '4.0-11.0' },
  plt: { low: 150, high: 400, display: '150-400' },
  bilirubin_total: { low: 0.2, high: 1.2, display: '0.2-1.2' },
  sgot: { low: 5, high: 40, display: '5-40' },
  sgpt: { low: 7, high: 56, display: '7-56' },
  alk_phos: { low: 44, high: 147, display: '44-147' },
  ggt: { low: 9, high: 48, display: '9-48' },
  albumin: { low: 3.5, high: 5.0, display: '3.5-5.0' },
  urea: { low: 15, high: 45, display: '15-45' },
  creatinine: { low: 0.6, high: 1.2, display: '0.6-1.2' },
  hba1c: { low: 0, high: 5.7, display: '<5.7%' },
  tac_level: { low: 8, high: 12, display: 'Target 8-12' },
};

/**
 * Classify a numeric value against a reference range.
 *   - normal: within [low, high]
 *   - warn:   within the amber margin just outside the range
 *   - high:   beyond the warn margin on either side (above OR below)
 * Returns null when there is no range for the key or the value isn't numeric.
 */
export function classify(
  key: string,
  value: number | string | null | undefined
): ClinicalStatus | null {
  const range = REFERENCE_RANGES[key];
  if (!range) return null;
  // Treat empty/whitespace strings as "no value" — Number('') is 0, which would
  // otherwise misclassify a blank cell.
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;

  if (n >= range.low && n <= range.high) return 'normal';

  const band = range.high - range.low;
  const margin = band * (range.warnFraction ?? 0.1);
  const withinWarn = n >= range.low - margin && n <= range.high + margin;
  return withinWarn ? 'warn' : 'high';
}
