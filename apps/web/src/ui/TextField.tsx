import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Content rendered inside the field on the left (e.g. a "+91" country code). */
  leadingAddon?: ReactNode;
  /** Content rendered inside the field on the right (e.g. a unit like "g/dL"). */
  trailingAddon?: ReactNode;
  error?: string;
}

export function TextField({
  label,
  leadingAddon,
  trailingAddon,
  error,
  id,
  style,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {label && (
        <label htmlFor={inputId} style={{ fontWeight: 600, fontSize: '15px' }}>
          {label}
        </label>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--color-surface)',
          border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '0 16px',
        }}
      >
        {leadingAddon && (
          <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>{leadingAddon}</span>
        )}
        <input
          {...rest}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--color-text)',
            fontSize: '16px',
            padding: '16px 0',
            minWidth: 0,
            ...style,
          }}
        />
        {trailingAddon && <span style={{ color: 'var(--color-text-muted)' }}>{trailingAddon}</span>}
      </div>
      {error && (
        <span id={errorId} role="alert" style={{ color: 'var(--color-danger)', fontSize: '13px' }}>
          {error}
        </span>
      )}
    </div>
  );
}
