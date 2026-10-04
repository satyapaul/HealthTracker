import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { HomeIcon, ChartIcon, ChatIcon, CareTeamIcon, ProfileIcon, type IconProps } from './icons';
import { branding, brandMonogram } from '../config/branding';
import { clearSession } from '../api/session';

interface Tab {
  to: string;
  label: string;
  Icon: (p: IconProps) => JSX.Element;
}

const TABS: Tab[] = [
  { to: '/app/home', label: 'Home', Icon: HomeIcon },
  { to: '/app/chart', label: 'Chart', Icon: ChartIcon },
  { to: '/app/chat', label: 'Chat', Icon: ChatIcon },
  { to: '/app/care-team', label: 'Care Team', Icon: CareTeamIcon },
  { to: '/app/profile', label: 'Profile', Icon: ProfileIcon },
];

/**
 * Responsive patient portal frame (product steering: one responsive website).
 *   - Mobile (<900px): phone-width column with a fixed bottom-tab nav
 *     (matches patient-home-dashboard mock).
 *   - Desktop (>=900px): a persistent left sidebar nav + a wide content area.
 * Same routes/screens; the layout is CSS-driven via .patient-* classes.
 */
export function PatientShell({ children }: { children: ReactNode }) {
  return (
    <div className="patient-shell">
      <DesktopSidebar />
      <div className="patient-shell__inner">
        <main className="patient-shell__main">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}

function DesktopSidebar() {
  const navigate = useNavigate();
  return (
    <aside className="patient-sidebar" aria-label="Primary">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '4px 12px 20px',
        }}
      >
        <span
          aria-hidden
          style={{
            width: '40px',
            height: '40px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-accent)',
            color: 'var(--color-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '18px',
          }}
        >
          {brandMonogram()}
        </span>
        <strong style={{ fontSize: '18px' }}>{branding.appName}</strong>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '15px',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: isActive ? 'var(--color-surface-accent)' : 'transparent',
            })}
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => {
          clearSession();
          navigate('/welcome', { replace: true });
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 14px',
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          fontWeight: 600,
          fontSize: '15px',
          cursor: 'pointer',
          borderRadius: 'var(--radius-md)',
        }}
      >
        Sign out
      </button>
    </aside>
  );
}

function BottomNav() {
  return (
    <nav
      className="patient-bottom-nav"
      aria-label="Primary"
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {TABS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            padding: '10px 0 12px',
            textDecoration: 'none',
            fontSize: '12px',
            fontWeight: 600,
            color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
          })}
        >
          {({ isActive }) => (
            <>
              <Icon size={24} strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
