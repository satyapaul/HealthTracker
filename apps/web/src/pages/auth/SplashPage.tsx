import { useNavigate } from 'react-router-dom';
import { Button, ArrowRightIcon, ShieldCheckIcon } from '../../ui';
import { branding } from '../../config/branding';

/**
 * Welcome splash (mock: Welcome-spash). First screen for a new/unauthenticated
 * visitor: brand mark + name + tagline (all config-driven — never hardcode the
 * product name), a hero area, a Get Started CTA into the login screen, and
 * trust badges. Get Started -> /welcome.
 */
export function SplashPage() {
  const navigate = useNavigate();
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
          padding: '56px 24px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <LogoMark />
        <h1
          style={{
            fontSize: '40px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            marginTop: '24px',
            textTransform: 'uppercase',
          }}
        >
          {branding.appName}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '20px', marginTop: '10px' }}>
          {branding.tagline}
        </p>

        <div
          aria-hidden
          style={{
            width: '100%',
            aspectRatio: '3 / 2',
            marginTop: '28px',
            borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, #cdd0a8, #b9c79c)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ShieldCheckIcon size={72} />
        </div>

        <div style={{ flex: 1 }} />

        <Button
          size="lg"
          block
          leading={<ArrowRightIcon size={20} />}
          onClick={() => navigate('/welcome')}
          style={{ marginTop: '32px' }}
        >
          Get Started
        </Button>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginTop: '16px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <TrustBadge>HIPAA Compliant</TrustBadge>
          <TrustBadge>256-bit Encrypted</TrustBadge>
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '88px',
        height: '88px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-accent)',
        color: 'var(--color-primary)',
      }}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7h9v8H2V9" />
        <path d="M12 10h4l3 3v2h-7z" />
        <circle cx="7" cy="17" r="1.6" />
        <circle cx="16" cy="17" r="1.6" />
        <path d="M6 5.5h3M7.5 4v3" />
      </svg>
    </span>
  );
}

function TrustBadge({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: 'var(--color-surface-accent)',
        color: 'var(--color-primary)',
        borderRadius: 'var(--radius-pill)',
        padding: '8px 14px',
        fontSize: '13px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      <ShieldCheckIcon size={16} />
      {children}
    </span>
  );
}
