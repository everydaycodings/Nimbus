// lib/upload/performUpload.ts
// Single source of truth for uploading one file to the Drive: chooses single
// presigned PUT vs. S3 multipart by size, uploads the (best-effort) thumbnail,
// and finalizes. Used by both useUpload (drag/drop/picker) and useFolderUpload
// so large files inside folder uploads get the same multipart + retry path.
//
// Store/UI concerns (progress bars, cancel buttons, cleanup) live in the hooks;
// this function is pure transport + API orchestration.

import { uploadToS3 } from "./uploadToS3";
import { uploadParts } from "./multipartUpload";

// Files larger than this use S3 multipart (parallel parts, per-part retry).
export const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50 MB

export interface PerformUploadArgs {
  file: File;
  parentFolderId?: string | null;
  fileIdForVersioning?: string;
  thumbnailBlob?: Blob | null;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  // Called as soon as the server identifiers are known, so the caller can
  // support cancel/cleanup (fileId + multipart uploadId).
  onMeta?: (meta: { fileId: string; uploadId?: string }) => void;
}

export async function performUpload(args: PerformUploadArgs): Promise<{ fileId: string }> {
  const { file, parentFolderId, fileIdForVersioning, thumbnailBlob, signal, onProgress, onMeta } =
    args;

  const baseBody = {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    parentFolderId,
    fileId: fileIdForVersioning,
    withThumbnail: !!thumbnailBlob,
  };

  if (file.size > MULTIPART_THRESHOLD) {
    const initRes = await fetch("/api/upload/multipart/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseBody),
    });
    if (!initRes.ok) {
      const { error } = await initRes.json();
      throw new Error(error ?? "Failed to start upload");
    }

    const { fileId, uploadId, partSize, parts, thumbnailPresignedUrl, thumbnailKey } =
      await initRes.json();
    onMeta?.({ fileId, uploadId });

    const partsPromise = uploadParts(file, partSize, parts, { signal, onProgress });
    const thumbPromise =
      thumbnailPresignedUrl && thumbnailBlob
        ? uploadToS3(thumbnailPresignedUrl, thumbnailBlob, { signal }).catch(() => null)
        : Promise.resolve(null);

    const [completedParts] = await Promise.all([partsPromise, thumbPromise]);

    const completeRes = await fetch("/api/upload/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId,
        uploadId,
        parts: completedParts,
        originalFileId: fileIdForVersioning,
        thumbnailKey,
      }),
    });
    if (!completeRes.ok) {
      const { error } = await completeRes.json();
      throw new Error(error ?? "Failed to finalize upload");
    }

    return { fileId };
  }

  // ── Single presigned PUT ──
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(baseBody),
  });
  if (!presignRes.ok) {
    const { error } = await presignRes.json();
    throw new Error(error ?? "Failed to get upload URL");
  }

  const { presignedUrl, fileId, thumbnailPresignedUrl, thumbnailKey } =
    await presignRes.json();
  onMeta?.({ fileId });

  const uploadPromises: Promise<unknown>[] = [
    uploadToS3(presignedUrl, file, { signal, onProgress }),
  ];
  if (thumbnailPresignedUrl && thumbnailBlob) {
    // Best-effort — a failed thumbnail must not fail the file.
    uploadPromises.push(
      uploadToS3(thumbnailPresignedUrl, thumbnailBlob, { signal }).catch(() => null)
    );
  }
  await Promise.all(uploadPromises);

  const completeRes = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileId,
      originalFileId: fileIdForVersioning,
      thumbnailKey,
    }),
  });
  if (!completeRes.ok) {
    const { error } = await completeRes.json();
    throw new Error(error ?? "Failed to finalize upload");
  }

  return { fileId };
}
