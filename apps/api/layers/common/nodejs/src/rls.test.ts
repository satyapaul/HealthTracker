import { describe, it, expect } from 'vitest';
import {
  RlsContextError,
  normalizeAuthorizerContext,
  applyRlsContext,
  withRlsContext,
  type QueryRunner,
  type RlsContext,
} from './rls';

interface RecordedCall {
  sql: string;
  params: unknown[];
}

/** Fake QueryRunner that records every call for assertion. */
class FakeRunner implements QueryRunner {
  readonly calls: RecordedCall[] = [];

  async query(sql: string, params: unknown[]): Promise<unknown> {
    this.calls.push({ sql, params });
    return undefined;
  }
}

describe('applyRlsContext', () => {
  it('issues exactly three parameterized set_config calls with values bound as params', async () => {
    const runner = new FakeRunner();
    const ctx: RlsContext = { userId: 'user-123', role: 'patient', patientId: 'pat-456' };

    await applyRlsContext(runner, ctx);

    expect(runner.calls).toHaveLength(3);

    expect(runner.calls[0].sql).toBe("SELECT set_config('app.current_user_id', $1, true)");
    expect(runner.calls[0].params).toEqual(['user-123']);

    expect(runner.calls[1].sql).toBe("SELECT set_config('app.current_role', $1, true)");
    expect(runner.calls[1].params).toEqual(['patient']);

    expect(runner.calls[2].sql).toBe("SELECT set_config('app.current_patient_id', $1, true)");
    expect(runner.calls[2].params).toEqual(['pat-456']);

    // Prove no interpolation: the dynamic values live in params, never the SQL.
    for (const call of runner.calls) {
      expect(call.sql).not.toContain('user-123');
      expect(call.sql).not.toContain('pat-456');
    }
  });

  it('sends empty string for a null patientId (doctor/admin)', async () => {
    const runner = new FakeRunner();
    const ctx: RlsContext = { userId: 'doc-1', role: 'doctor', patientId: null };

    await applyRlsContext(runner, ctx);

    expect(runner.calls[2].sql).toBe("SELECT set_config('app.current_patient_id', $1, true)");
    expect(runner.calls[2].params).toEqual(['']);
  });

  it('never concatenates a raw value into any SQL string', async () => {
    const runner = new FakeRunner();
    const secretUser = "u'; DROP TABLE patients;--";
    const secretPatient = "p'; DELETE FROM follow_up_rows;--";
    const ctx: RlsContext = { userId: secretUser, role: 'caregiver', patientId: secretPatient };

    await applyRlsContext(runner, ctx);

    for (const call of runner.calls) {
      expect(call.sql).not.toContain(secretUser);
      expect(call.sql).not.toContain(secretPatient);
    }
    // Values reached the DB only via params.
    expect(runner.calls[0].params).toEqual([secretUser]);
    expect(runner.calls[2].params).toEqual([secretPatient]);
  });
});

describe('normalizeAuthorizerContext', () => {
  it('accepts a patient with a patientId', () => {
    const ctx = normalizeAuthorizerContext({
      userId: 'u1',
      role: 'patient',
      patientId: 'pat-1',
    });
    expect(ctx).toEqual({ userId: 'u1', role: 'patient', patientId: 'pat-1' });
  });

  it('accepts a caregiver with a patientId', () => {
    const ctx = normalizeAuthorizerContext({
      userId: 'u2',
      role: 'caregiver',
      patientId: 'pat-2',
    });
    expect(ctx).toEqual({ userId: 'u2', role: 'caregiver', patientId: 'pat-2' });
  });

  it('throws for a patient with a missing patientId', () => {
    expect(() => normalizeAuthorizerContext({ userId: 'u1', role: 'patient' })).toThrow(
      RlsContextError
    );
  });

  it('throws for a patient with an empty-string patientId', () => {
    expect(() =>
      normalizeAuthorizerContext({ userId: 'u1', role: 'patient', patientId: '' })
    ).toThrow(RlsContextError);
  });

  it('throws for a caregiver with a null patientId', () => {
    expect(() =>
      normalizeAuthorizerContext({ userId: 'u2', role: 'caregiver', patientId: null })
    ).toThrow(RlsContextError);
  });

  it('forces patientId to null for a doctor even if one is provided', () => {
    const ctx = normalizeAuthorizerContext({
      userId: 'doc-1',
      role: 'doctor',
      patientId: 'pat-spoof',
    });
    expect(ctx).toEqual({ userId: 'doc-1', role: 'doctor', patientId: null });
  });

  it("normalizes '' patientId to null for doctor/admin", () => {
    const doctor = normalizeAuthorizerContext({ userId: 'doc-1', role: 'doctor', patientId: '' });
    expect(doctor.patientId).toBeNull();

    const admin = normalizeAuthorizerContext({ userId: 'adm-1', role: 'admin', patientId: '' });
    expect(admin).toEqual({ userId: 'adm-1', role: 'admin', patientId: null });
  });

  it('throws for an unknown role', () => {
    expect(() => normalizeAuthorizerContext({ userId: 'u1', role: 'superuser' })).toThrow(
      RlsContextError
    );
  });

  it('throws for an empty userId', () => {
    expect(() => normalizeAuthorizerContext({ userId: '', role: 'admin' })).toThrow(
      RlsContextError
    );
  });

  it('throws for a missing userId', () => {
    expect(() => normalizeAuthorizerContext({ role: 'admin' })).toThrow(RlsContextError);
  });

  it('sets a stable error code and no PHI-bearing message', () => {
    try {
      normalizeAuthorizerContext({ userId: 'u1', role: 'patient' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RlsContextError);
      expect((err as RlsContextError).code).toBe('RLS_CONTEXT_INVALID');
    }
  });
});

describe('withRlsContext', () => {
  it('runs BEGIN, the three set_config calls, then COMMIT and returns fn value', async () => {
    const runner = new FakeRunner();
    const ctx: RlsContext = { userId: 'u1', role: 'patient', patientId: 'pat-1' };

    const result = await withRlsContext(runner, ctx, async () => 'ok');

    expect(result).toBe('ok');
    const sqls = runner.calls.map((c) => c.sql);
    expect(sqls).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_user_id', $1, true)",
      "SELECT set_config('app.current_role', $1, true)",
      "SELECT set_config('app.current_patient_id', $1, true)",
      'COMMIT',
    ]);
  });

  it('runs ROLLBACK and rethrows when fn throws', async () => {
    const runner = new FakeRunner();
    const ctx: RlsContext = { userId: 'u1', role: 'patient', patientId: 'pat-1' };
    const boom = new Error('fn failed');

    await expect(
      withRlsContext(runner, ctx, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    const sqls = runner.calls.map((c) => c.sql);
    expect(sqls).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_user_id', $1, true)",
      "SELECT set_config('app.current_role', $1, true)",
      "SELECT set_config('app.current_patient_id', $1, true)",
      'ROLLBACK',
    ]);
    expect(sqls).not.toContain('COMMIT');
  });
});
