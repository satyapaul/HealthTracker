import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WelcomePage } from './WelcomePage';
import { branding } from '../../config/branding';

function renderWelcome() {
  return render(
    <MemoryRouter>
      <WelcomePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('WelcomePage', () => {
  it('renders the config-driven brand name, not a hardcoded one', () => {
    renderWelcome();
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    // The tagline uses branding.appName from config.
    expect(screen.getByText(`Secure login for ${branding.appName}`)).toBeInTheDocument();
  });

  it('offers Google + Facebook OAuth and SMS OTP (no Apple)', () => {
    renderWelcome();
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with Facebook/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send OTP/i })).toBeInTheDocument();
    // Apple sign-in was removed.
    expect(screen.queryByRole('button', { name: /Continue with Apple/i })).not.toBeInTheDocument();
  });

  it('validates the phone number before requesting an OTP', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderWelcome();
    await user.click(screen.getByRole('button', { name: /Send OTP/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid mobile number/i);
    // No network call made for an invalid number.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
