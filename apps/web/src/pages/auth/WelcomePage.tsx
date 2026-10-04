import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField, ShieldCheckIcon } from '../../ui';
import { branding } from '../../config/branding';
import { authApi, type OAuthProvider } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { getSession } from '../../api/session';
import { homePathForRole } from '../../auth/RequireAuth';
import { OtpVerifyPanel } from './OtpVerifyPanel';

/**
 * Welcome / sign-in screen (mock: RecoverEase-WelcomeBack). Offers OAuth
 * (Google/X/Facebook) and SMS OTP. Branding copy is config-driven — the product
 * name comes from branding.appName, never hardcoded here.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSendOtp = async () => {
    setError(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError('Enter a valid mobile number.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await authApi.requestOtp(`+91${digits}`);
      setChallengeId(result.challengeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onOAuth = (provider: OAuthProvider) => {
    // Redirect-based OAuth: hand off to the backend authorize endpoint.
    // (Backend wiring lands with the auth integration WP.)
    setError(`${labelFor(provider)} sign-in isn't wired to the backend yet.`);
  };

  if (challengeId) {
    return (
      <OtpVerifyPanel
        challengeId={challengeId}
        phoneHint={`+91 ${phone}`}
        onBack={() => setChallengeId(null)}
        onVerified={() => {
          // Route to the signed-in user's portal based on the resolved role.
          const session = getSession();
          navigate(session ? homePathForRole(session.role) : '/app/home', { replace: true });
        }}
      />
    );
  }

  return (
    <div
      className="auth-screen"
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div
        className="auth-card"
        style={{
          width: '100%',
          maxWidth: '480px',
          padding: '48px 24px 24px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '40px', fontWeight: 700, letterSpacing: '-0.5px' }}>
            Welcome back
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '18px', marginTop: '8px' }}>
            Secure login for {branding.appName}
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Button variant="secondary" size="lg" block onClick={() => onOAuth('google')}>
            Continue with Google
          </Button>
          <Button variant="secondary" size="lg" block onClick={() => onOAuth('x')}>
            Continue with X
          </Button>
          <Button variant="secondary" size="lg" block onClick={() => onOAuth('facebook')}>
            Continue with Facebook
          </Button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--color-text-muted)',
            margin: '28px 0',
          }}
        >
          <span style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
          or
          <span style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
        </div>

        <TextField
          label="Enter Mobile Number"
          inputMode="tel"
          placeholder="Phone number"
          leadingAddon="+91"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={error ?? undefined}
        />

        <div style={{ flex: 1 }} />

        <Button
          size="lg"
          block
          onClick={onSendOtp}
          disabled={submitting}
          leading={<ShieldCheckIcon size={20} />}
          style={{ marginTop: '24px' }}
        >
          {submitting ? 'Sending…' : 'Send OTP'}
        </Button>

        <p
          style={{
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: '13px',
            marginTop: '16px',
          }}
        >
          By continuing you agree to{' '}
          <a href={branding.legal.termsUrl} style={{ color: 'var(--color-primary)' }}>
            Terms of Service
          </a>{' '}
          &amp;{' '}
          <a href={branding.legal.privacyUrl} style={{ color: 'var(--color-primary)' }}>
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}

function labelFor(p: OAuthProvider): string {
  return p === 'google' ? 'Google' : p === 'x' ? 'X' : 'Facebook';
}
