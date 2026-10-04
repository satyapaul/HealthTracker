/**
 * Design tokens, derived from the CX mocks (CX-mocks/). These are the single
 * source of truth for color/spacing/radius/typography. They are mirrored into
 * CSS custom properties by applyTheme() so both inline styles and theme.css can
 * reference them. Theming is config-driven — swapping this object (e.g. per
 * hospital branding later) restyles the whole app with no component changes.
 */
export interface ThemeTokens {
  color: {
    /** Warm off-white app background (mock canvas). */
    bg: string;
    /** Primary surface (white cards). */
    surface: string;
    /** Secondary tinted surface (pale green panels, pill badges). */
    surfaceAccent: string;
    /** Forest-green brand/primary (buttons, active nav, headings accents). */
    primary: string;
    primaryHover: string;
    /** Text on primary. */
    onPrimary: string;
    /** Primary text (near-black). */
    text: string;
    /** Muted/secondary text. */
    textMuted: string;
    /** Hairline borders around cards/inputs. */
    border: string;
    /** Status colors for the clinical flow chart legend. */
    statusHighBg: string;
    statusHighText: string;
    statusWarnBg: string;
    statusWarnText: string;
    statusNormalBg: string;
    statusNormalText: string;
    /** Danger (destructive / dose-reduced emphasis). */
    danger: string;
    dangerSurface: string;
  };
  radius: {
    sm: string;
    md: string;
    lg: string;
    pill: string;
  };
  space: (n: number) => string;
  font: {
    family: string;
    weightRegular: number;
    weightMedium: number;
    weightBold: number;
  };
  shadow: {
    card: string;
    sheet: string;
  };
}

export const theme: ThemeTokens = {
  color: {
    bg: '#f5f4ef',
    surface: '#ffffff',
    surfaceAccent: '#e4ede4',
    primary: '#2f4f3e',
    primaryHover: '#263f32',
    onPrimary: '#ffffff',
    text: '#14181a',
    textMuted: '#5f6b63',
    border: '#e2e3dd',
    statusHighBg: '#fce4e4',
    statusHighText: '#b4231f',
    statusWarnBg: '#fbf1d4',
    statusWarnText: '#8a6a16',
    statusNormalBg: '#d9efdd',
    statusNormalText: '#1f6b36',
    danger: '#b4231f',
    dangerSurface: '#fcebea',
  },
  radius: {
    sm: '8px',
    md: '14px',
    lg: '20px',
    pill: '999px',
  },
  space: (n: number) => `${n * 4}px`,
  font: {
    family: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    weightRegular: 400,
    weightMedium: 600,
    weightBold: 700,
  },
  shadow: {
    card: '0 1px 2px rgba(20, 24, 26, 0.04)',
    sheet: '0 -8px 30px rgba(20, 24, 26, 0.12)',
  },
};

/** Mirror the token object into :root CSS custom properties. */
export function applyTheme(t: ThemeTokens = theme, root: HTMLElement): void {
  const c = t.color;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set('--color-bg', c.bg);
  set('--color-surface', c.surface);
  set('--color-surface-accent', c.surfaceAccent);
  set('--color-primary', c.primary);
  set('--color-primary-hover', c.primaryHover);
  set('--color-on-primary', c.onPrimary);
  set('--color-text', c.text);
  set('--color-text-muted', c.textMuted);
  set('--color-border', c.border);
  set('--color-status-high-bg', c.statusHighBg);
  set('--color-status-high-text', c.statusHighText);
  set('--color-status-warn-bg', c.statusWarnBg);
  set('--color-status-warn-text', c.statusWarnText);
  set('--color-status-normal-bg', c.statusNormalBg);
  set('--color-status-normal-text', c.statusNormalText);
  set('--color-danger', c.danger);
  set('--color-danger-surface', c.dangerSurface);
  set('--radius-sm', t.radius.sm);
  set('--radius-md', t.radius.md);
  set('--radius-lg', t.radius.lg);
  set('--radius-pill', t.radius.pill);
  set('--font-family', t.font.family);
  set('--shadow-card', t.shadow.card);
  set('--shadow-sheet', t.shadow.sheet);
}
