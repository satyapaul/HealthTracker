import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DoctorDashboardPage } from './DoctorDashboardPage';
import type { FollowUpRow, PatientChart } from '../../api/types';

function chart(overrides: Partial<PatientChart> = {}): PatientChart {
  return {
    id: 'p1',
    name: 'Test Patient',
    ageYears: 40,
    sex: 'M',
    maxId: 'MAX-1',
    photoUrl: null,
    dateOfOperation: '2026-05-01',
    diagnosis: 'DCLD',
    histopathology: 'x',
    anastomosisType: 'y',
    contactEmail: null,
    phoneNumber: null,
    whatsappNumber: null,
    procedureHospitalId: 'hosp-1',
    defaultFollowupHospitalId: 'hosp-1',
    primaryDoctorId: 'doctor-1',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function row(overrides: Partial<FollowUpRow>): FollowUpRow {
  return {
    id: 'r1',
    patientId: 'p1',
    ppDate: '2026-06-01',
    status: 'reviewed',
    labValues: { hb: 9.8 }, // below Hb range -> should classify 'high'
    drugLevels: { tac_level: 15.3 }, // above Tac target -> 'high'
    patientReportedDoses: { pred: '5' },
    doctorPrescribedDoses: null,
    weightKg: 54,
    notes: null,
    engagementHospitalId: 'hosp-1',
    engagementHospitalName: 'Test Hospital',
    submittedAt: '2026-06-01T00:00:00Z',
    reviewedAt: null,
    reviewedBy: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function installFetch(rows: FollowUpRow[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const ok = (data: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, data, error: null })),
        } as unknown as Response);

      if (/\/followup\/patients\/[^/]+\/rows$/.test(url)) return ok({ rows });
      if (url.includes('/patients')) {
        return ok({
          patients: [{ patient: chart(), pendingSubmissionCount: 1, hasPending: true }],
        });
      }
      return ok(null);
    })
  );
}

function renderDash() {
  return render(
    <MemoryRouter>
      <DoctorDashboardPage />
    </MemoryRouter>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('DoctorDashboardPage', () => {
  it('lists assigned patients and renders the selected patient flow chart with coding', async () => {
    installFetch([row({})]);
    renderDash();

    // Patient appears in the sidebar with a pending badge.
    expect(await screen.findByRole('button', { name: /Test Patient/ })).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();

    // Flow chart renders the Hb value (out-of-range), plus the legend.
    expect(await screen.findByText('9.8')).toBeInTheDocument();
    const legend = screen.getByText('Legend:').closest('div')!;
    expect(within(legend).getByText('High')).toBeInTheDocument();
  });

  it('shows a graceful empty state when the patient has no rows', async () => {
    installFetch([]);
    renderDash();

    expect(await screen.findByRole('button', { name: /Test Patient/ })).toBeInTheDocument();
    expect(await screen.findByText(/No submissions yet/i)).toBeInTheDocument();
  });
});
