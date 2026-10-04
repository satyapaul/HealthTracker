import type { ReactNode } from 'react';
import { Card } from '../../ui';
import { ValueRow, AmPmRow } from './ValueRow';
import { LAB_GROUPS, DRUG_LEVEL_FIELDS, DOSE_FIELDS, ALL_LAB_FIELDS } from './field-catalog';
import type { WizardState } from './wizard-state';
import { combineAmPm } from './wizard-state';

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-muted)',
        fontSize: '13px',
        fontWeight: 700,
        margin: '8px 0 4px',
      }}
    >
      {children}
    </p>
  );
}

// ── Step 1 — Labs ────────────────────────────────────────────────────────────
export function LabsStep({
  state,
  onLabChange,
  onAttach,
}: {
  state: WizardState;
  onLabChange: (key: string, value: string) => void;
  onAttach: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Lab Values</h2>
      {LAB_GROUPS.map((group) => (
        <section
          key={group.title}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          <GroupTitle>{group.title}</GroupTitle>
          {group.fields.map((f) => (
            <ValueRow
              key={f.key}
              label={f.label}
              unit={f.unit}
              placeholder={f.placeholder}
              inputMode={f.kind === 'labText' ? 'text' : 'decimal'}
              value={state.labs[f.key] ?? ''}
              onChange={(v) => onLabChange(f.key, v)}
            />
          ))}
        </section>
      ))}

      <button
        type="button"
        onClick={onAttach}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          padding: '24px',
          marginTop: '8px',
          border: '2px dashed var(--color-primary)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-surface-accent)',
          color: 'var(--color-primary)',
          cursor: 'pointer',
        }}
      >
        <strong style={{ fontSize: '16px' }}>
          {state.attachedFileName ?? 'Attach Lab Report (PDF/Photo)'}
        </strong>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
          Provides direct medical verification for your care team
        </span>
      </button>
    </div>
  );
}

// ── Step 2 — Meds ────────────────────────────────────────────────────────────
export function MedsStep({
  state,
  onDrugLevelChange,
  onDoseChange,
  onAmPmChange,
  onWeightChange,
  onNotesChange,
}: {
  state: WizardState;
  onDrugLevelChange: (key: string, value: string) => void;
  onDoseChange: (key: string, value: string) => void;
  onAmPmChange: (key: string, next: { am: string; pm: string }) => void;
  onWeightChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <GroupTitle>Immunosuppressant Drug Levels</GroupTitle>
      {DRUG_LEVEL_FIELDS.map((f) => (
        <ValueRow
          key={f.key}
          label={f.label}
          unit={f.unit}
          value={state.drugLevels[f.key] ?? ''}
          onChange={(v) => onDrugLevelChange(f.key, v)}
        />
      ))}

      <GroupTitle>Current Daily Doses</GroupTitle>
      {DOSE_FIELDS.map((f) =>
        f.amPm ? (
          <AmPmRow
            key={f.key}
            label={f.label}
            am={state.dosesAmPm[f.key]?.am ?? ''}
            pm={state.dosesAmPm[f.key]?.pm ?? ''}
            onChange={(next) => onAmPmChange(f.key, next)}
          />
        ) : (
          <ValueRow
            key={f.key}
            label={f.label}
            unit={f.unit}
            value={state.doses[f.key] ?? ''}
            onChange={(v) => onDoseChange(f.key, v)}
          />
        )
      )}

      <h3 style={{ fontSize: '18px', fontWeight: 700, marginTop: '8px' }}>Current Weight</h3>
      <ValueRow
        label="Weight"
        unit="kg"
        placeholder="Enter weight"
        value={state.weightKg}
        onChange={onWeightChange}
      />

      <h3 style={{ fontSize: '18px', fontWeight: 700, marginTop: '8px' }}>
        Patient Notes / Symptoms
      </h3>
      <textarea
        value={state.notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Any symptoms or notes for your doctor…"
        rows={4}
        style={{
          width: '100%',
          resize: 'vertical',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          fontSize: '16px',
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          background: 'var(--color-surface)',
          outline: 'none',
        }}
      />
    </div>
  );
}

// ── Step 3 — Review ──────────────────────────────────────────────────────────
export function ReviewStep({
  state,
  onEditLabs,
  onEditMeds,
}: {
  state: WizardState;
  onEditLabs: () => void;
  onEditMeds: () => void;
}) {
  const labLines = ALL_LAB_FIELDS.filter((f) => (state.labs[f.key]?.trim() ?? '') !== '').map(
    (f) => ({ label: f.label, value: `${state.labs[f.key]}${f.unit ? ` ${f.unit}` : ''}` })
  );

  const doseLines = DOSE_FIELDS.map((f) => {
    const v = f.amPm ? combineAmPm(state.dosesAmPm[f.key]) : (state.doses[f.key]?.trim() ?? '');
    return v ? { label: f.label, value: `${v}${f.unit ? ` ${f.unit}` : ''}` } : null;
  }).filter((x): x is { label: string; value: string } => x !== null);

  const drugLines = DRUG_LEVEL_FIELDS.filter(
    (f) => (state.drugLevels[f.key]?.trim() ?? '') !== ''
  ).map((f) => ({ label: f.label, value: `${state.drugLevels[f.key]} ${f.unit ?? ''}`.trim() }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Review Submission</h2>
      <Card>
        <SummarySection title="Lab Values" onEdit={onEditLabs} lines={labLines} />
        <Divider />
        <SummarySection
          title="Medications"
          onEdit={onEditMeds}
          lines={[
            ...drugLines,
            ...doseLines,
            ...(state.weightKg.trim() ? [{ label: 'Weight', value: `${state.weightKg} kg` }] : []),
          ]}
        />
        {state.attachedFileName && (
          <>
            <Divider />
            <GroupTitle>Attached Lab Report</GroupTitle>
            <div
              style={{
                background: 'var(--color-surface-accent)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                color: 'var(--color-primary)',
                fontWeight: 600,
              }}
            >
              {state.attachedFileName}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function SummarySection({
  title,
  onEdit,
  lines,
}: {
  title: string;
  onEdit: () => void;
  lines: { label: string; value: string }[];
}) {
  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <GroupTitle>{title}</GroupTitle>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--color-primary)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
      </div>
      {lines.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Nothing entered.</p>
      ) : (
        lines.map((l) => (
          <p key={l.label} style={{ marginTop: '4px' }}>
            {l.label}: <strong>{l.value}</strong>
          </p>
        ))
      )}
    </section>
  );
}

function Divider() {
  return (
    <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />
  );
}
