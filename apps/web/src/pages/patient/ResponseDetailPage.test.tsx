import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResponseDetailPage } from './ResponseDetailPage';

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const ok = (data: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, data, error: null })),
        } as unknown as Response);

      if (/\/dose-changes$/.test(url)) {
        return ok({
          doseChanges: [
            {
              id: 'dc1',
              followUpRowId: 'row-1',
              fieldName: 'aza_mpa',
              oldValue: '1/1',
              newValue: '0.5/0.5',
              changedBy: 'doctor-1',
              changedAt: '2026-08-30T10:00:00Z',
              reason: 'levels stable',
            },
          ],
        });
      }
      if (/\/response$/.test(url)) {
        return ok({
          id: 'resp-1',
          followUpRowId: 'row-1',
          doctorId: 'doctor-1',
          additionalTests: ['Liver Ultrasound', { name: 'CMV PCR (Blood test)' }],
          additionalMedications: null,
          clinicalNotes: 'Continue current Tac dose. Monitor creatinine.',
          nextFollowupIntervalDays: 14,
          sentAt: '2026-08-30T10:00:00Z',
        });
      }
      return ok(null);
    })
  );
}

function renderAt(rowId: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/rows/${rowId}/response`]}>
      <Routes>
        <Route path="/app/rows/:rowId/response" element={<ResponseDetailPage />} />
        <Route path="/app/chat" element={<div>chat</div>} />
        <Route path="/app/chart" element={<div>chart</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ResponseDetailPage', () => {
  it('renders dose changes, additional tests, and clinical remarks', async () => {
    installFetch();
    renderAt('row-1');

    // Dose change old -> new (label mapped from the catalog: aza_mpa -> Aza / MPA).
    expect(await screen.findByText(/Aza \/ MPA dose changed/i)).toBeInTheDocument();
    expect(screen.getByText('0.5/0.5')).toBeInTheDocument();
    expect(screen.getByText('Action Required')).toBeInTheDocument();

    // Additional tests (string + {name} forms both render).
    expect(screen.getByText('Liver Ultrasound')).toBeInTheDocument();
    expect(screen.getByText('CMV PCR (Blood test)')).toBeInTheDocument();

    // Clinical remarks + next follow-up.
    expect(screen.getByText(/Monitor creatinine/)).toBeInTheDocument();
    expect(screen.getByText(/14 days/)).toBeInTheDocument();
  });
});
