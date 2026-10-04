import { describe, expect, it } from 'vitest';
import { combineAmPm, emptyWizardState, hasAnyLab, toCreateBody } from './wizard-state';

describe('wizard-state', () => {
  it('combines AM/PM into dose notation, treating blanks as 0', () => {
    expect(combineAmPm({ am: '4', pm: '4' })).toBe('4/4');
    expect(combineAmPm({ am: '1.5', pm: '' })).toBe('1.5/0');
    expect(combineAmPm({ am: '', pm: '2' })).toBe('0/2');
    expect(combineAmPm({ am: '', pm: '' })).toBe('');
    expect(combineAmPm(undefined)).toBe('');
  });

  it('hasAnyLab is false for an empty state and true once a lab is entered', () => {
    const s = emptyWizardState('2026-09-10');
    expect(hasAnyLab(s)).toBe(false);
    s.labs.hb = '12.1';
    expect(hasAnyLab(s)).toBe(true);
  });

  it('builds the typed POST body with correct buckets and types', () => {
    const s = emptyWizardState('2026-09-10');
    s.engagementHospitalId = 'hosp-1';
    s.labs.hb = '12.1'; // numeric lab
    s.labs.na_k = '138 / 4.2'; // text lab
    s.drugLevels.tac_level = '8.1'; // numeric drug level
    s.dosesAmPm.neoral_tac = { am: '4', pm: '4' }; // am/pm dose
    s.doses.pred = '5'; // single dose
    s.weightKg = '18.5';
    s.notes = 'feeling well';

    const body = toCreateBody(s);

    expect(body.ppDate).toBe('2026-09-10');
    expect(body.engagementHospitalId).toBe('hosp-1');
    expect(body.labValues.hb).toBe(12.1);
    expect(typeof body.labValues.hb).toBe('number');
    expect(body.labValues.na_k).toBe('138 / 4.2');
    expect(body.drugLevels.tac_level).toBe(8.1);
    expect(body.patientReportedDoses.neoral_tac).toBe('4/4');
    expect(body.patientReportedDoses.pred).toBe('5');
    expect(body.weightKg).toBe(18.5);
    expect(body.notes).toBe('feeling well');
  });

  it('omits empty values from the body', () => {
    const s = emptyWizardState('2026-09-10');
    s.engagementHospitalId = 'hosp-1';
    s.labs.hb = '11';
    const body = toCreateBody(s);
    expect(Object.keys(body.labValues)).toEqual(['hb']);
    expect(body.drugLevels).toEqual({});
    expect(body.patientReportedDoses).toEqual({});
    expect(body.weightKg).toBeUndefined();
    expect(body.notes).toBeUndefined();
  });
});
