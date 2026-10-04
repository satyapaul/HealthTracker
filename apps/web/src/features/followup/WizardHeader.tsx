import { ArrowLeftIcon, Pill, HospitalIcon } from '../../ui';

export type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = { 1: 'Labs', 2: 'Meds', 3: 'Review' };

export interface WizardHeaderProps {
  current: WizardStep;
  hospitalName?: string | null;
  onBack: () => void;
  onJumpTo?: (step: WizardStep) => void;
}

/**
 * Sticky top header for the Submit Follow-Up wizard: a back affordance, the
 * "Step N of 3" label, and the Labs/Meds/Review progress indicator with
 * completed check marks (mock: lab-values-entry / medications / review).
 */
export function WizardHeader({ current, hospitalName, onBack, onJumpTo }: WizardHeaderProps) {
  return (
    <header
      style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '16px 20px 12px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: 'var(--color-text)',
            padding: 0,
            marginTop: '2px',
          }}
        >
          <ArrowLeftIcon size={24} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>Submit Follow-Up</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Step {current} of 3</p>
        </div>
        {hospitalName && (
          <Pill tone="accent">
            <HospitalIcon size={16} /> {hospitalName}
          </Pill>
        )}
      </div>

      <ol
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          listStyle: 'none',
          padding: 0,
          margin: '16px 0 0',
        }}
      >
        {([1, 2, 3] as WizardStep[]).map((step) => {
          const done = step < current;
          const active = step === current;
          const clickable = onJumpTo && step < current;
          return (
            <li key={step}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onJumpTo?.(step)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  cursor: clickable ? 'pointer' : 'default',
                  color: active || done ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontWeight: 700,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: 'var(--radius-pill)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    background:
                      active || done ? 'var(--color-primary)' : 'var(--color-surface-accent)',
                    color: active || done ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
                  }}
                >
                  {done ? '✓' : step}
                </span>
                {STEP_LABELS[step]}
              </button>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
