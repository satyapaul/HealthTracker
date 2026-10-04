import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SubmitFollowUpPage } from './SubmitFollowUpPage';
import { setSession, clearSession } from '../../api/session';
import type { HospitalSummary } from '../../api/types';

const HOSPITALS: HospitalSummary[] = [
  {
    id: 'hosp-1',
    hospitalCode: 'SHMS',
    hospitalName: 'Test Hospital',
    hospitalType: 'general',
    city: 'New Delhi',
    logoUrl: null,
    status: 'active',
  },
];

/** A fetch mock routing by URL + method to the right envelope. */
function installFetch() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });

    const ok = (data: unknown, status = 200) =>
      Promise.resolve({
        ok: true,
        status,
        text: () => Promise.resolve(JSON.stringify({ success: true, data, error: null })),
      } as unknown as Response);

    if (url.includes('/hospitals')) return ok({ hospitals: HOSPITALS });
    if (url.endsWith('/followup/rows') && method === 'POST')
      return ok({ id: 'row-1', status: 'draft' }, 201);
    if (/\/followup\/rows\/row-1\/submit$/.test(url)) return ok({ id: 'row-1', status: 'pending' });
    return ok(null);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/app/submit']}>
      <SubmitFollowUpPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  setSession({ token: 'tok', role: 'patient', patientId: 'patient-1' });
});

afterEach(() => {
  clearSession();
  vi.restoreAllMocks();
});

describe('SubmitFollowUpPage', () => {
  it('runs the full flow: pick hospital, enter a lab, step to review, submit', async () => {
    const calls = installFetch();
    const user = userEvent.setup();
    renderWizard();

    // Picker opens up-front; choose the hospital and confirm.
    await user.click(await screen.findByText(/Test Hospital/));
    await user.click(screen.getByRole('button', { name: /Confirm Selection/i }));

    // Step 1 — enter a Hemoglobin value.
    const hb = screen.getByLabelText(/Hemoglobin \(Hb\)/i);
    await user.type(hb, '12.1');
    await user.click(screen.getByRole('button', { name: /Next: Medications/i }));

    // Step 2 — advance to review.
    await user.click(screen.getByRole('button', { name: /Next: Review/i }));

    // Step 3 — review shows the entered lab, then submit.
    expect(screen.getByText(/Review Submission/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Submit for Review/i }));

    // createDraft (POST) then submit (PUT) were called with the right payload.
    const post = calls.find((c) => c.url.endsWith('/followup/rows') && c.method === 'POST');
    expect(post).toBeTruthy();
    expect(post!.body).toMatchObject({
      engagementHospitalId: 'hosp-1',
      labValues: { hb: 12.1 },
    });
    expect(calls.some((c) => /\/row-1\/submit$/.test(c.url))).toBe(true);
  });

  it('blocks advancing past Labs with no lab value', async () => {
    installFetch();
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByText(/Test Hospital/));
    await user.click(screen.getByRole('button', { name: /Confirm Selection/i }));

    await user.click(screen.getByRole('button', { name: /Next: Medications/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/at least one lab value/i)).toBeInTheDocument();
    // Still on step 1.
    expect(screen.getByText(/Lab Values/i)).toBeInTheDocument();
  });
});
