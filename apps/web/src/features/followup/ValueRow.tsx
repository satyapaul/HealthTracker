import { useId } from 'react';

/**
 * A single-line labeled input styled like the mock rows: label on the left, a
 * right-aligned numeric/text value with a trailing unit inside one bordered
 * card. Used for lab values, drug levels, and single-value doses.
 */
export function ValueRow({
  label,
  value,
  unit,
  placeholder,
  inputMode = 'decimal',
  onChange,
}: {
  label: string;
  value: string;
  unit?: string;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
      }}
    >
      <label htmlFor={id} style={{ flex: 1, fontWeight: 600 }}>
        {label}
      </label>
      <input
        id={id}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder ?? 'Value'}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '96px',
          textAlign: 'right',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--color-text)',
        }}
      />
      {unit && (
        <span style={{ color: 'var(--color-text-muted)', fontSize: '14px', minWidth: '36px' }}>
          {unit}
        </span>
      )}
    </div>
  );
}

/** AM/PM dose row: label on the left, two small inputs ("4 AM | 4 PM"). */
export function AmPmRow({
  label,
  am,
  pm,
  onChange,
}: {
  label: string;
  am: string;
  pm: string;
  onChange: (next: { am: string; pm: string }) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
      }}
    >
      <span style={{ flex: 1, fontWeight: 600 }}>{label}</span>
      <DoseBox label="AM" value={am} onChange={(v) => onChange({ am: v, pm })} />
      <span aria-hidden style={{ color: 'var(--color-border)' }}>
        |
      </span>
      <DoseBox label="PM" value={pm} onChange={(v) => onChange({ am, pm: v })} />
    </div>
  );
}

function DoseBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <input
        id={id}
        inputMode="decimal"
        aria-label={label}
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '40px',
          textAlign: 'right',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--color-text)',
        }}
      />
      <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{label}</span>
    </span>
  );
}
