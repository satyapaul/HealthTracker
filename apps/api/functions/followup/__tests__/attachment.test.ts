/**
 * WP 2.4 lab-report attachment endpoint tests (presign / confirm / list). All
 * dependencies are injected fakes — no real AWS / DB. Covers the DoD surface
 * (upload a report linked to a follow-up date) and the validation + RLS
 * invariants. The virus-scan / EICAR invariant is covered in virus-scan tests.
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { FollowupRequest, Principal } from '../http';
import { makeBundle } from './fakes';

function req(
  partial: Partial<FollowupRequest> & Pick<FollowupRequest, 'method' | 'path'>
): FollowupRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, query: {}, ...partial };
}

function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string } | null;
} {
  return JSON.parse(body);
}

const patient = (patientId: string): Principal => ({
  userId: `user-${patientId}`,
  role: 'patient',
  patientId,
});

/** Seed a draft row owned by p1 and return its id. */
function seedRow(
  b: ReturnType<typeof makeBundle>,
  status: 'draft' | 'pending' | 'reviewed'
): string {
  const id = 'fur-1';
  b.db.rows.set(id, {
    id,
    patientId: 'p1',
    ppDate: '2026-08-16',
    status,
    labValues: { hb: 10 },
    drugLevels: {},
    patientReportedDoses: {},
    doctorPrescribedDoses: null,
    weightKg: null,
    notes: null,
    engagementHospitalId: 'hosp-1',
    engagementHospitalName: 'Test Hospital',
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  });
  return id;
}

const PRESIGN = (id: string) => `/followup/rows/${id}/attachments/presign`;
const CONFIRM = (id: string) => `/followup/rows/${id}/attachments/confirm`;
const LIST = (id: string) => `/followup/rows/${id}/attachments`;

describe('POST .../attachments/presign', () => {
  it('returns a presigned URL + objectKey for an allowed PDF', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p1'),
        body: JSON.stringify({
          filename: 'labs.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 204800,
        }),
      })
    );
    expect(res.statusCode).toBe(201);
    const data = parse(res.body).data as Record<string, string>;
    expect(data.uploadUrl).toContain('https://s3.test/');
    // objectKey shape: patients/{patientId}/rows/{rowId}/{uuid}.pdf
    expect(data.objectKey).toMatch(/^patients\/p1\/rows\/fur-1\/[^/]+\.pdf$/);
    expect(data.expiresAt).toBeTruthy();
    // Intent cached for the confirm step.
    expect(b.uploadIntents.store.has(data.objectKey)).toBe(true);
  });

  it('rejects an unsupported MIME type', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p1'),
        body: JSON.stringify({
          filename: 'x.exe',
          mimeType: 'application/x-msdownload',
          fileSizeBytes: 100,
        }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a file larger than the max', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p1'),
        body: JSON.stringify({
          filename: 'big.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 20 * 1024 * 1024 + 1,
        }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects presign on a reviewed row', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'reviewed');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p1'),
        body: JSON.stringify({
          filename: 'labs.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 100,
        }),
      })
    );
    expect(res.statusCode).toBe(403);
  });

  it('DENIES presign for another patient (404)', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p2'),
        body: JSON.stringify({
          filename: 'labs.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 100,
        }),
      })
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('POST .../attachments/confirm', () => {
  async function presign(b: ReturnType<typeof makeBundle>, id: string): Promise<string> {
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p1'),
        body: JSON.stringify({
          filename: 'labs.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 100,
        }),
      })
    );
    return (parse(res.body).data as Record<string, string>).objectKey;
  }

  it('registers an attachment (pending) once the object exists in S3', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const objectKey = await presign(b, id);
    b.s3.markUploaded(objectKey); // simulate the client PUT

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: CONFIRM(id),
        principal: patient('p1'),
        body: JSON.stringify({ objectKey, filename: 'labs.pdf' }),
      })
    );
    expect(res.statusCode).toBe(201);
    const data = parse(res.body).data as Record<string, string>;
    expect(data.attachmentId).toBeTruthy();
    expect(data.scanStatus).toBe('pending');
    expect(b.db.attachments).toHaveLength(1);
    expect(b.db.attachments[0].objectKey).toBe(objectKey);
    // Intent consumed.
    expect(b.uploadIntents.store.has(objectKey)).toBe(false);
  });

  it('404 when the object was never uploaded to S3', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const objectKey = await presign(b, id);
    // Do NOT markUploaded.
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: CONFIRM(id),
        principal: patient('p1'),
        body: JSON.stringify({ objectKey, filename: 'labs.pdf' }),
      })
    );
    expect(res.statusCode).toBe(404);
    expect(b.db.attachments).toHaveLength(0);
  });

  it('rejects an objectKey with no matching intent', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: CONFIRM(id),
        principal: patient('p1'),
        body: JSON.stringify({ objectKey: 'patients/p1/rows/fur-1/forged.pdf', filename: 'x.pdf' }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects confirm by a different user than presigned', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const objectKey = await presign(b, id);
    b.s3.markUploaded(objectKey);
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: CONFIRM(id),
        principal: { userId: 'user-p1-other', role: 'caregiver', patientId: 'p1' },
        body: JSON.stringify({ objectKey, filename: 'labs.pdf' }),
      })
    );
    // Intent was recorded for user-p1; a different userId fails the match.
    expect(res.statusCode).toBe(400);
  });
});

describe('GET .../attachments (list)', () => {
  it('lists attachments on the row for the owner', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    // presign + confirm one attachment
    const presignRes = await route(
      b.deps,
      req({
        method: 'POST',
        path: PRESIGN(id),
        principal: patient('p1'),
        body: JSON.stringify({
          filename: 'labs.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 100,
        }),
      })
    );
    const objectKey = (parse(presignRes.body).data as Record<string, string>).objectKey;
    b.s3.markUploaded(objectKey);
    await route(
      b.deps,
      req({
        method: 'POST',
        path: CONFIRM(id),
        principal: patient('p1'),
        body: JSON.stringify({ objectKey, filename: 'labs.pdf' }),
      })
    );

    const res = await route(
      b.deps,
      req({ method: 'GET', path: LIST(id), principal: patient('p1') })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { attachments: unknown[] }).attachments;
    expect(list).toHaveLength(1);
  });

  it('DENIES listing for another patient (404)', async () => {
    const b = makeBundle();
    const id = seedRow(b, 'draft');
    const res = await route(
      b.deps,
      req({ method: 'GET', path: LIST(id), principal: patient('p2') })
    );
    expect(res.statusCode).toBe(404);
  });
});
