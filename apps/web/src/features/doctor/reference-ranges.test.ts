import { describe, expect, it } from 'vitest';
import { classify } from './reference-ranges';

describe('reference-range classify', () => {
  it('returns normal for a value within range', () => {
    expect(classify('hb', 15)).toBe('normal');
    expect(classify('hb', 13.5)).toBe('normal'); // inclusive low
    expect(classify('hb', 17.5)).toBe('normal'); // inclusive high
  });

  it('returns warn just outside the range (within the amber margin)', () => {
    // Hb band = 4.0, 10% margin = 0.4 -> [13.1, 17.9] warn.
    expect(classify('hb', 13.2)).toBe('warn');
    expect(classify('hb', 17.8)).toBe('warn');
  });

  it('returns high beyond the warn margin on either side', () => {
    expect(classify('hb', 9.8)).toBe('high'); // well below
    expect(classify('hb', 20)).toBe('high'); // well above
  });

  it('returns null for unknown keys or non-numeric values', () => {
    expect(classify('not_a_param', 5)).toBeNull();
    expect(classify('hb', '')).toBeNull();
    expect(classify('hb', null)).toBeNull();
    expect(classify('hb', 'abc')).toBeNull();
  });

  it('codes the Tac target band (8-12)', () => {
    expect(classify('tac_level', 10)).toBe('normal');
    expect(classify('tac_level', 12.3)).toBe('warn'); // band 4, margin 0.4
    expect(classify('tac_level', 15.3)).toBe('high');
  });
});
