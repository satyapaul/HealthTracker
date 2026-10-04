import { useState } from 'react';
import { Button, TextField } from '../../ui';
import { authApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { setSession } from '../../api/session';

export interface OtpVerifyPanelProps {
  challengeId: string;
  /** Masked/partial phone shown back to the user. */
  phoneHint: string;
  onBack: () => void;
  onVerified: () => void;
}

/** Second step of SMS sign-in: enter the 6-digit code to establish a session. */
export function OtpVerifyPanel({
  challengeId,
  phoneHint,
  onBack,
  onVerified,
}: OtpVerifyPanelProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onVerify = async () => {
    setError(null);
    const digits = code.replace(/\D/g, '');
    if (digits.length < 4) {
      setError('Enter the code sent to your phone.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await authApi.verifyOtp(challengeId, digits);
      setSession({ token: result.token, role: result.role, patientId: result.patientId });
      onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          padding: '48px 24px 24px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '34px', fontWeight: 700 }}>Enter code</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '16px', marginTop: '8px' }}>
            We sent a verification code to {phoneHint}
          </p>
        </header>

        <TextField
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="------"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error ?? undefined}
        />

        <div style={{ flex: 1 }} />

        <Button size="lg" block onClick={onVerify} disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify & Continue'}
        </Button>
        <Button variant="ghost" block onClick={onBack} style={{ marginTop: '8px' }}>
          Use a different number
        </Button>
      </div>
    </div>
  );
}
