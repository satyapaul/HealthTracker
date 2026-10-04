import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { HomeIcon, ChartIcon, ChatIcon, CareTeamIcon, ProfileIcon, type IconProps } from './icons';

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
 * Mobile patient portal frame: a scrollable content area above a fixed
 * bottom-tab navigation, matching the patient-home-dashboard mock. Centers on a
 * phone-width column so it reads well on desktop web too (responsive, one
 * surface per the product steering).
 */
export function PatientShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg)',
          position: 'relative',
        }}
      >
        <main style={{ flex: 1, padding: '20px 20px 96px' }}>{children}</main>

        <nav
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
      </div>
    </div>
  );
}
