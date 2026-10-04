import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Use the pale-green tinted surface (e.g. the "next follow-up due" panel). */
  accent?: boolean;
  padding?: number;
  children: ReactNode;
}

export function Card({ accent = false, padding = 4, children, style, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      style={{
        background: accent ? 'var(--color-surface-accent)' : 'var(--color-surface)',
        border: accent ? '1px solid transparent' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: `${padding * 4}px`,
        boxShadow: accent ? 'none' : 'var(--shadow-card)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
