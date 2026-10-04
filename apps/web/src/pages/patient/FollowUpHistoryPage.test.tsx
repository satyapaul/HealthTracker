import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FollowUpHistoryPage } from './FollowUpHistoryPage';
import type { FollowUpRow } from '../../api/types';

function row(overrides: Partial<FollowUpRow>): FollowUpRow {
  return {
    id: 'r1',
    patientId: 'p1',
    ppDate: '2026-08-29',
    status: 'reviewed',
    labValues: { hb: 12.1, plt: 180, bilirubin_total: 0.8, sgot: 32 },
    drugLevels: {},
    patientReportedDoses: { neoral_tac: '4/4', pred: '5' },
    doctorPrescribedDoses: null,
    weightKg: null,
    notes: null,
    engagementHospitalId: 'hosp-1',
    engagementHospitalName: 'SHMS',
    submittedAt: '2026-08-29T00:00:00Z',
    reviewedAt: '2026-08-30T00:00:00Z',
    reviewedBy: 'doctor-1',
    createdAt: '2026-08-29T00:00:00Z',
    updatedAt: '2026-08-30T00:00:00Z',
    ...overrides,
  };
}

function stubRows(rows: FollowUpRow[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ success: true, data: { rows }, error: null })),
    } as unknown as Response)
  );
}

afterEach(() => vi.restoreAllMocks());

describe('FollowUpHistoryPage', () => {
  it('renders rows with status pills and a per-hospital filter', async () => {
    stubRows([
      row({
        id: 'r1',
        engagementHospitalId: 'hosp-1',
        engagementHospitalName: 'SHMS',
        status: 'reviewed',
      }),
      row({
        id: 'r2',
        ppDate: '2026-08-20',
        engagementHospitalId: 'virtual',
        engagementHospitalName: 'Virtual',
        status: 'pending',
      }),
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FollowUpHistoryPage />
      </MemoryRouter>
    );

    // Both status pills present once loaded.
    expect(await screen.findByText(/Reviewed/)).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();

    // Filter chips: All + the two hospitals.
    const virtualChip = screen.getByRole('button', { name: 'Virtual' });
    await user.click(virtualChip);

    // Only the Virtual (pending) row remains; the reviewed SHMS row is filtered out.
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/Reviewed/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no rows', async () => {
    stubRows([]);
    render(
      <MemoryRouter>
        <FollowUpHistoryPage />
      </MemoryRouter>
    );
    expect(await screen.findByText(/No follow-ups yet/i)).toBeInTheDocument();
  });
});
