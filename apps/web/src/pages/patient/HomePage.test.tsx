import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import type { FollowUpRow } from '../../api/types';

function row(overrides: Partial<FollowUpRow>): FollowUpRow {
  return {
    id: 'r1',
    patientId: 'p1',
    ppDate: '2026-08-29',
    status: 'reviewed',
    labValues: { hb: 12.1, hba1c: 5.2 },
    drugLevels: { tac_level: 8.1 },
    patientReportedDoses: {},
    doctorPrescribedDoses: { pred: '5' },
    weightKg: 18.5,
    notes: null,
    engagementHospitalId: 'hosp-1',
    engagementHospitalName: 'Test Hospital',
    submittedAt: '2026-08-29T00:00:00.000Z',
    reviewedAt: '2026-08-30T00:00:00.000Z',
    reviewedBy: 'doctor-1',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  it('shows a greeting and the Submit Now CTA', async () => {
    stubRows([]);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /Welcome/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Now/i })).toBeInTheDocument();
    // Empty history message once loaded.
    expect(await screen.findByText(/No updates yet/i)).toBeInTheDocument();
  });

  it('derives last lab stats and a reviewed update from the latest row', async () => {
    stubRows([row({})]);
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    // Tac level from drugLevels, weight from weightKg.
    expect(await screen.findByText('8.1')).toBeInTheDocument();
    expect(screen.getByText('18.5')).toBeInTheDocument();
    expect(screen.getByText('5.2%')).toBeInTheDocument();

    // A reviewed row with doctorPrescribedDoses renders as a dose adjustment.
    await waitFor(() => expect(screen.getByText(/Dose adjustment/i)).toBeInTheDocument());
  });
});
