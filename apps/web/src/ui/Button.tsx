import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Stretch to the container width (primary CTAs in the mocks are full-width). */
  block?: boolean;
  /** Optional leading icon/element. */
  leading?: ReactNode;
  children: ReactNode;
}

const base: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '10px',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-pill)',
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'background-color 120ms ease, border-color 120ms ease, opacity 120ms ease',
  textDecoration: 'none',
};

const sizes: Record<Size, React.CSSProperties> = {
  md: { padding: '12px 20px', fontSize: '15px' },
  lg: { padding: '18px 24px', fontSize: '17px' },
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--color-primary)',
    color: 'var(--color-on-primary)',
  },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-primary)',
    borderColor: 'var(--color-primary)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-primary)',
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  leading,
  children,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        ...base,
        ...sizes[size],
        ...variants[variant],
        width: block ? '100%' : undefined,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? 'none' : undefined,
        ...style,
      }}
    >
      {leading}
      {children}
    </button>
  );
}
