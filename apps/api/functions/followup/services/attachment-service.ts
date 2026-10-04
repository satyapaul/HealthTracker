/**
 * Lab-report attachment business logic (WP 2.4 — spec §7.3 P-03, LLD §4.3).
 *
 * Two-step upload:
 *   1. presign — validate MIME/size + row ownership, mint an objectKey, return a
 *      presigned S3 PUT URL, and record a short-lived upload intent. No DB row
 *      yet (the file isn't uploaded).
 *   2. confirm — verify the object actually landed in S3 (HeadObject) and that
 *      it matches a known intent, then INSERT the attachment row with
 *      scan_status='pending'. The S3 event then triggers the virus-scan Lambda.
 *
 * Authorization: patient/caregiver only (they own the row). RLS (V7) is the
 * second gate — a row the caller cannot see yields NOT_FOUND.
 */
import { AppError } from '../envelope';
import type { FollowupDeps } from '../deps';
import type { Principal } from '../http';
import type { AttachmentRecord, SessionContext } from '../ports/db';

/** Map an allowed MIME type to a file extension for the object key. */
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function patientContext(principal: Principal): { ctx: SessionContext; patientId: string } {
  if (principal.role !== 'patient' && principal.role !== 'caregiver') {
    throw new AppError('FORBIDDEN', 'Only a patient or caregiver may upload lab reports');
  }
  const patientId =
    typeof principal.patientId === 'string' && principal.patientId.length > 0
      ? principal.patientId
      : null;
  if (patientId === null) {
    throw new AppError('FORBIDDEN', 'No patient is linked to this account');
  }
  return { ctx: { userId: principal.userId, role: principal.role, patientId }, patientId };
}

export interface PresignCommand {
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface PresignResult {
  uploadUrl: string;
  objectKey: string;
  expiresAt: string;
}

/** Step 1: validate + presign an upload for a follow-up row. */
export async function presignAttachment(
  deps: FollowupDeps,
  principal: Principal,
  rowId: string,
  cmd: PresignCommand
): Promise<PresignResult> {
  const { ctx, patientId } = patientContext(principal);

  // MIME allowlist (spec §7.3 / LLD §4.3).
  if (!deps.config.allowedMimeTypes.includes(cmd.mimeType)) {
    throw new AppError('VALIDATION_ERROR', 'Unsupported file type', { field: 'mimeType' });
  }
  // Size cap (<=20MB). 413-style; we surface as VALIDATION_ERROR per the envelope.
  if (!Number.isFinite(cmd.fileSizeBytes) || cmd.fileSizeBytes <= 0) {
    throw new AppError('VALIDATION_ERROR', 'fileSizeBytes must be a positive number', {
      field: 'fileSizeBytes',
    });
  }
  if (cmd.fileSizeBytes > deps.config.maxUploadBytes) {
    throw new AppError('VALIDATION_ERROR', 'File exceeds the maximum allowed size', {
      field: 'fileSizeBytes',
    });
  }

  // Verify the row belongs to the caller (RLS-scoped read).
  const row = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.findRowById(rowId);
  });
  if (!row) {
    throw new AppError('NOT_FOUND', 'Follow-up row not found');
  }
  // Attachments are added while the patient is still working the row.
  if (row.status === 'reviewed') {
    throw new AppError('FORBIDDEN', 'Cannot attach files to a reviewed row');
  }

  // Build the object key: patients/{patientId}/rows/{rowId}/{uuid}.{ext}
  const ext = EXT_BY_MIME[cmd.mimeType];
  const objectKey = `patients/${patientId}/rows/${rowId}/${deps.ids.uuid()}.${ext}`;

  const presigned = await deps.s3.presignPut(objectKey, cmd.mimeType, deps.config.maxUploadBytes);

  await deps.uploadIntents.put(
    objectKey,
    {
      rowId,
      patientId,
      uploadedBy: principal.userId,
      mimeType: cmd.mimeType,
      originalFilename: cmd.filename,
    },
    deps.config.uploadIntentTtlSeconds
  );

  deps.logger.info('followup.attachment.presigned', {
    rowId,
    patientId,
    userId: principal.userId,
  });

  return { uploadUrl: presigned.uploadUrl, objectKey, expiresAt: presigned.expiresAt };
}

export interface ConfirmCommand {
  objectKey: string;
  filename: string;
}

/** Step 2: confirm the upload landed and register the attachment row. */
export async function confirmAttachment(
  deps: FollowupDeps,
  principal: Principal,
  rowId: string,
  cmd: ConfirmCommand
): Promise<AttachmentRecord> {
  const { ctx } = patientContext(principal);

  // The objectKey must match a known pending intent for THIS row + caller.
  const intent = await deps.uploadIntents.get(cmd.objectKey);
  if (!intent || intent.rowId !== rowId || intent.uploadedBy !== principal.userId) {
    throw new AppError('VALIDATION_ERROR', 'objectKey does not match a pending upload', {
      field: 'objectKey',
    });
  }

  // Verify the object actually exists in S3 (HeadObject).
  if (!(await deps.s3.objectExists(cmd.objectKey))) {
    throw new AppError('NOT_FOUND', 'Uploaded object not found');
  }

  const attachment = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const row = await repo.findRowById(rowId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Follow-up row not found');
    }
    return repo.insertAttachment({
      id: deps.ids.uuid(),
      followUpRowId: rowId,
      objectKey: cmd.objectKey,
      originalFilename: cmd.filename,
      mimeType: intent.mimeType,
      fileSizeBytes: null, // true size is confirmed by the scanner from S3 metadata
      uploadedBy: principal.userId,
    });
  });

  // Intent consumed.
  await deps.uploadIntents.del(cmd.objectKey);

  deps.logger.info('followup.attachment.confirmed', {
    rowId,
    attachmentId: attachment.id,
    userId: principal.userId,
    scanStatus: attachment.scanStatus,
  });

  return attachment;
}

/** List the attachments on a row (RLS-scoped). */
export async function listAttachments(
  deps: FollowupDeps,
  principal: Principal,
  rowId: string
): Promise<AttachmentRecord[]> {
  // Any role whose RLS lets them see the row may list its attachments; reuse the
  // patient/caregiver context builder is too narrow, so build a generic context.
  let ctx: SessionContext;
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    ctx = patientContext(principal).ctx;
  } else {
    ctx = { userId: principal.userId, role: principal.role, patientId: null };
  }

  return deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const row = await repo.findRowById(rowId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Follow-up row not found');
    }
    return repo.listAttachments(rowId);
  });
}
