import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HospitalPicker } from './HospitalPicker';
import type { HospitalSummary } from '../../api/types';

const HOSPITALS: HospitalSummary[] = [
  {
    id: 'virtual',
    hospitalCode: 'VIRTUAL',
    hospitalName: 'Virtual / Remote Consultation',
    hospitalType: 'virtual',
    city: null,
    logoUrl: null,
    status: 'active',
    pinned: true,
  },
  {
    id: 'hosp-1',
    hospitalCode: 'SHMS',
    hospitalName: 'Shri Mata Mandir Hospital',
    hospitalType: 'general',
    city: 'New Delhi',
    logoUrl: null,
    status: 'active',
  },
];

function stubHospitals(hospitals = HOSPITALS) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({ success: true, data: { hospitals }, error: null })),
    } as unknown as Response)
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HospitalPicker', () => {
  it('lists Virtual (pinned) and affiliated hospitals, confirming the selection', async () => {
    stubHospitals();
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(<HospitalPicker open patientId="patient-1" onClose={() => {}} onConfirm={onConfirm} />);

    // Both options render.
    expect(await screen.findByText(/Virtual \/ Remote Consultation/)).toBeInTheDocument();
    expect(screen.getByText(/Shri Mata Mandir Hospital/)).toBeInTheDocument();

    // Confirm is disabled until something is selected.
    const confirm = screen.getByRole('button', { name: /Confirm Selection/i });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByText(/Shri Mata Mandir Hospital/));
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ id: 'hosp-1', name: 'Shri Mata Mandir Hospital' });
  });

  it('filters the list by the search query', async () => {
    stubHospitals();
    const user = userEvent.setup();
    render(<HospitalPicker open patientId="patient-1" onClose={() => {}} onConfirm={() => {}} />);

    await screen.findByText(/Shri Mata Mandir Hospital/);
    await user.type(screen.getByLabelText(/Search hospital/i), 'shri');

    expect(screen.getByText(/Shri Mata Mandir Hospital/)).toBeInTheDocument();
    expect(screen.queryByText(/Virtual \/ Remote Consultation/)).not.toBeInTheDocument();
  });
});
