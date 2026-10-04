import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpVerifyPanel } from './OtpVerifyPanel';
import { getSession, clearSession } from '../../api/session';

/** Stub /auth/otp/verify then /auth/me, by URL. */
function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const ok = (data: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, data, error: null })),
        } as unknown as Response);

      if (url.endsWith('/auth/otp/verify')) {
        return ok({
          sessionToken: 'tok-xyz',
          expiresAt: '2026-10-01T00:00:00Z',
          user: { id: 'user-patient-1', role: 'patient', displayName: 'Raghavendra' },
        });
      }
      if (url.endsWith('/auth/me')) {
        return ok({
          id: 'user-patient-1',
          role: 'patient',
          displayName: 'Raghavendra',
          email: null,
          status: 'active',
          linkedPatientId: 'patient-1',
        });
      }
      return ok(null);
    })
  );
}

afterEach(() => {
  clearSession();
  vi.restoreAllMocks();
});

describe('OtpVerifyPanel', () => {
  it('verifies the code, resolves the profile, and stores the session', async () => {
    installFetch();
    const onVerified = vi.fn();
    const user = userEvent.setup();

    render(
      <OtpVerifyPanel
        challengeId="chal-1"
        phoneHint="+91 9999900001"
        onBack={() => {}}
        onVerified={onVerified}
      />
    );

    await user.type(screen.getByLabelText(/Verification code/i), '424242');
    await user.click(screen.getByRole('button', { name: /Verify & Continue/i }));

    // Session stored with the token + role + linked patient from /auth/me.
    await vi.waitFor(() => {
      expect(getSession()).toEqual({
        token: 'tok-xyz',
        role: 'patient',
        patientId: 'patient-1',
      });
    });
    expect(onVerified).toHaveBeenCalled();
  });

  it('shows an error and clears the session on an invalid code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: false,
              data: null,
              error: { code: 'INVALID_OTP', message: 'Incorrect OTP' },
            })
          ),
      } as unknown as Response)
    );
    const user = userEvent.setup();
    render(
      <OtpVerifyPanel
        challengeId="chal-1"
        phoneHint="+91 9999900001"
        onBack={() => {}}
        onVerified={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/Verification code/i), '000000');
    await user.click(screen.getByRole('button', { name: /Verify & Continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Incorrect OTP/i);
    expect(getSession()).toBeNull();
  });
});
