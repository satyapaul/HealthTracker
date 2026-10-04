import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from './client';
import { setSession, clearSession } from './session';

/** Build a fetch Response-like stub. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearSession();
});

describe('apiRequest envelope handling', () => {
  it('unwraps data on a success envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { id: 'p1' }, error: null }))
    );
    const data = await apiRequest<{ id: string }>('/patients/p1');
    expect(data).toEqual({ id: 'p1' });
  });

  it('throws a typed ApiError on a failure envelope, preserving code + details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            success: false,
            data: null,
            error: { code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'x' } },
          },
          400
        )
      )
    );
    await expect(apiRequest('/x')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'VALIDATION_ERROR',
      status: 400,
      details: { field: 'x' },
    });
  });

  it('throws BAD_RESPONSE on a non-JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('<html>oops', 502)));
    const err = await apiRequest('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('BAD_RESPONSE');
  });

  it('maps a transport failure to a NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const err = await apiRequest('/x').catch((e) => e);
    expect((err as ApiError).code).toBe('NETWORK_ERROR');
    expect((err as ApiError).status).toBe(0);
  });

  it('attaches the bearer token when a session is set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: null, error: null }));
    vi.stubGlobal('fetch', fetchMock);
    setSession({ token: 'tok-123', role: 'patient', patientId: 'p1' });

    await apiRequest('/patients/p1');

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-123');
  });

  it('omits auth when auth:false', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: null, error: null }));
    vi.stubGlobal('fetch', fetchMock);
    setSession({ token: 'tok-123', role: 'patient' });

    await apiRequest('/auth/otp/request', { method: 'POST', body: {}, auth: false });

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});
