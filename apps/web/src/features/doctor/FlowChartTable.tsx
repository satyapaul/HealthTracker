import type { FollowUpRow } from '../../api/types';
import { LAB_GROUPS, DRUG_LEVEL_FIELDS, DOSE_FIELDS } from '../followup/field-catalog';
import { REFERENCE_RANGES, classify } from './reference-ranges';

/**
 * Post-op investigation flow chart (mock: doctor/post-op-monitoring-dashboard).
 * A transposed table — parameters down the left (grouped, with reference
 * ranges), one column per submission date across the top — with High/Warn/
 * Normal cell coding. Horizontally scrollable for many dates.
 *
 * Status is paired with text (the value itself + the legend), never color
 * alone, so the coding is accessible.
 */
export interface FlowChartTableProps {
  rows: FollowUpRow[];
}

interface ParamDef {
  key: string;
  label: string;
  /** Which row bucket holds the value. */
  bucket: 'labValues' | 'drugLevels' | 'patientReportedDoses';
}

const GROUPS: { title: string; params: ParamDef[] }[] = [
  ...LAB_GROUPS.map((g) => ({
    title: g.title,
    params: g.fields.map((f) => ({ key: f.key, label: f.label, bucket: 'labValues' as const })),
  })),
  {
    title: 'Immunosuppression Drug Levels',
    params: DRUG_LEVEL_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      bucket: 'drugLevels' as const,
    })),
  },
  {
    title: 'Doses',
    params: DOSE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      bucket: 'patientReportedDoses' as const,
    })),
  },
];

const STATUS_STYLE = {
  high: { bg: 'var(--color-status-high-bg)', fg: 'var(--color-status-high-text)' },
  warn: { bg: 'var(--color-status-warn-bg)', fg: 'var(--color-status-warn-text)' },
  normal: { bg: 'transparent', fg: 'var(--color-text)' },
} as const;

export function FlowChartTable({ rows }: FlowChartTableProps) {
  const sorted = [...rows].sort((a, b) => (a.ppDate < b.ppDate ? -1 : 1));

  return (
    <div
      className="scroll-x"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          minWidth: `${220 + sorted.length * 120}px`,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                ...headCell,
                textAlign: 'left',
                position: 'sticky',
                left: 0,
                background: 'var(--color-primary)',
              }}
            >
              Parameter
            </th>
            {sorted.map((r) => (
              <th key={r.id} style={headCell}>
                {shortDate(r.ppDate)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((group) => (
            <GroupBlock key={group.title} group={group} rows={sorted} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({
  group,
  rows,
}: {
  group: { title: string; params: ParamDef[] };
  rows: FollowUpRow[];
}) {
  return (
    <>
      <tr>
        <td
          colSpan={rows.length + 1}
          style={{
            background: 'var(--color-surface-accent)',
            color: 'var(--color-primary)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: '12px',
            padding: '8px 12px',
          }}
        >
          {group.title}
        </td>
      </tr>
      {group.params.map((p) => (
        <tr key={p.key}>
          <td
            style={{
              ...bodyCell,
              textAlign: 'left',
              position: 'sticky',
              left: 0,
              background: 'var(--color-surface)',
            }}
          >
            <div style={{ fontWeight: 600 }}>{p.label}</div>
            {REFERENCE_RANGES[p.key] && (
              <div style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
                {REFERENCE_RANGES[p.key].display}
              </div>
            )}
          </td>
          {rows.map((r) => {
            const raw = (r[p.bucket] as Record<string, unknown> | null)?.[p.key];
            const value = raw === undefined || raw === null || raw === '' ? '—' : String(raw);
            const status =
              p.bucket === 'patientReportedDoses' ? null : classify(p.key, raw as number | string);
            const style = status ? STATUS_STYLE[status] : STATUS_STYLE.normal;
            return (
              <td key={r.id} style={bodyCell}>
                {value === '—' ? (
                  <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                ) : (
                  <span
                    style={{
                      display: 'inline-block',
                      background: style.bg,
                      color: style.fg,
                      fontWeight: status && status !== 'normal' ? 700 : 500,
                      padding: status && status !== 'normal' ? '2px 10px' : '2px 0',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {value}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/** The High/Warn/Normal legend shown beneath the chart. */
export function FlowChartLegend() {
  const items: { status: keyof typeof STATUS_STYLE; label: string; note: string }[] = [
    { status: 'high', label: 'High', note: 'Out of range' },
    { status: 'warn', label: 'Warn', note: 'Borderline' },
    { status: 'normal', label: 'Normal', note: 'Within range' },
  ];
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
      <strong style={{ fontSize: '14px' }}>Legend:</strong>
      {items.map((i) => (
        <span key={i.status} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background:
                i.status === 'normal' ? 'var(--color-status-normal-bg)' : STATUS_STYLE[i.status].bg,
              color:
                i.status === 'normal'
                  ? 'var(--color-status-normal-text)'
                  : STATUS_STYLE[i.status].fg,
              fontWeight: 700,
              fontSize: '12px',
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {i.label}
          </span>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{i.note}</span>
        </span>
      ))}
    </div>
  );
}

const headCell: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
  fontWeight: 700,
  fontSize: '13px',
  padding: '10px 12px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

const bodyCell: React.CSSProperties = {
  borderTop: '1px solid var(--color-border)',
  padding: '10px 12px',
  textAlign: 'center',
  fontSize: '14px',
  whiteSpace: 'nowrap',
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
}
