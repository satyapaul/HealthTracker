import { useEffect, useMemo, useState } from 'react';
import { BottomSheet, Button, TextField, GlobeIcon, HospitalIcon } from '../../ui';
import { hospitalApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { HospitalSummary } from '../../api/types';

export interface HospitalChoice {
  id: string;
  name: string;
}

export interface HospitalPickerProps {
  open: boolean;
  patientId: string;
  /** Currently selected hospital id (if any). */
  selectedId?: string | null;
  onClose: () => void;
  onConfirm: (choice: HospitalChoice) => void;
}

/**
 * Hospital-picker bottom sheet (mock: hospital-picker). Loads the patient's
 * primary doctor's active affiliations + the Virtual Hospital (pinned),
 * supports search, single-select, and confirms the engagement hospital for a
 * follow-up row. The Virtual option carries a telehealth sub-label.
 */
export function HospitalPicker({
  open,
  patientId,
  selectedId,
  onClose,
  onConfirm,
}: HospitalPickerProps) {
  const [hospitals, setHospitals] = useState<HospitalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<string | null>(selectedId ?? null);

  useEffect(() => {
    if (!open) return;
    setChoice(selectedId ?? null);
    setError(null);
    let active = true;
    hospitalApi
      .forPatient(patientId)
      .then((r) => {
        if (active) setHospitals(r.hospitals);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load hospitals.');
      });
    return () => {
      active = false;
    };
  }, [open, patientId, selectedId]);

  const { pinned, rest } = useMemo(
    () => splitAndFilter(hospitals ?? [], query),
    [hospitals, query]
  );
  const chosen = useMemo(
    () => (hospitals ?? []).find((h) => h.id === choice) ?? null,
    [hospitals, choice]
  );

  return (
    <BottomSheet
      open={open}
      title="Select Hospital"
      onClose={onClose}
      footer={
        <Button
          size="lg"
          block
          disabled={!chosen}
          onClick={() => chosen && onConfirm({ id: chosen.id, name: chosen.hospitalName })}
        >
          Confirm Selection
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <TextField
          placeholder="Search hospital…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search hospital"
        />

        {error && <p style={{ color: 'var(--color-danger)', fontSize: '14px' }}>{error}</p>}
        {!hospitals && !error && (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading hospitals…</p>
        )}

        {pinned.map((h) => (
          <HospitalRow
            key={h.id}
            hospital={h}
            selected={choice === h.id}
            onSelect={() => setChoice(h.id)}
            variant="virtual"
          />
        ))}

        {rest.length > 0 && (
          <p
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-muted)',
              fontSize: '12px',
              fontWeight: 700,
              marginTop: '4px',
            }}
          >
            Affiliated Hospitals
          </p>
        )}
        {rest.map((h) => (
          <HospitalRow
            key={h.id}
            hospital={h}
            selected={choice === h.id}
            onSelect={() => setChoice(h.id)}
            variant="standard"
          />
        ))}

        {hospitals && pinned.length === 0 && rest.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>No hospitals match “{query}”.</p>
        )}
      </div>
    </BottomSheet>
  );
}

function HospitalRow({
  hospital,
  selected,
  onSelect,
  variant,
}: {
  hospital: HospitalSummary;
  selected: boolean;
  onSelect: () => void;
  variant: 'virtual' | 'standard';
}) {
  const isVirtual = variant === 'virtual';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        width: '100%',
        textAlign: 'left',
        padding: '14px 16px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        background: selected && isVirtual ? 'var(--color-surface-accent)' : 'var(--color-surface)',
        border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
      }}
    >
      <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>
        {isVirtual ? <GlobeIcon size={24} /> : <HospitalIcon size={24} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700 }}>{hospital.hospitalName}</span>
        <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: '14px' }}>
          {isVirtual
            ? 'Telehealth, chat-only, or remote follow-ups'
            : `${hospital.hospitalCode}${hospital.city ? ` — ${hospital.city}` : ''}`}
        </span>
      </span>
      <RadioDot selected={selected} />
    </button>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: '24px',
        height: '24px',
        borderRadius: 'var(--radius-pill)',
        border: `2px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {selected && (
        <span
          style={{
            width: '12px',
            height: '12px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--color-primary)',
          }}
        />
      )}
    </span>
  );
}

function splitAndFilter(
  hospitals: HospitalSummary[],
  query: string
): { pinned: HospitalSummary[]; rest: HospitalSummary[] } {
  const q = query.trim().toLowerCase();
  const match = (h: HospitalSummary) =>
    q === '' ||
    h.hospitalName.toLowerCase().includes(q) ||
    h.hospitalCode.toLowerCase().includes(q) ||
    (h.city ?? '').toLowerCase().includes(q);
  const pinned = hospitals.filter((h) => h.pinned).filter(match);
  const rest = hospitals.filter((h) => !h.pinned).filter(match);
  return { pinned, rest };
}
