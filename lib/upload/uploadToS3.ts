// lib/upload/uploadToS3.ts
// Hardened S3 upload helper: AbortController support, retry with exponential
// backoff on transient failures, and typed errors so callers can react to the
// actual cause (network blip vs. expired URL vs. quota vs. server).

export type UploadErrorKind =
  | "network" // connection dropped / no response
  | "expired" // presigned URL no longer valid (S3 403)
  | "quota" // storage limit / 413
  | "server" // S3 5xx
  | "aborted" // user/programmatic cancel
  | "client"; // other 4xx — not retryable

export class UploadError extends Error {
  kind: UploadErrorKind;
  status?: number;

  constructor(kind: UploadErrorKind, message: string, status?: number) {
    super(message);
    this.name = "UploadError";
    this.kind = kind;
    this.status = status;
  }
}

export interface UploadToS3Options {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** Max attempts including the first try. Default 3. */
  maxAttempts?: number;
}

function classifyStatus(status: number): UploadError {
  if (status === 403) {
    return new UploadError("expired", "Upload link expired — please retry", status);
  }
  if (status === 413) {
    return new UploadError("quota", "File too large for storage limit", status);
  }
  if (status >= 500) {
    return new UploadError("server", `Storage server error (${status})`, status);
  }
  return new UploadError("client", `Upload rejected (${status})`, status);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("aborted", "Upload cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadError("aborted", "Upload cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// A single PUT attempt. Resolves with the response ETag on 2xx (needed for
// multipart completion), rejects with a typed UploadError otherwise.
function attemptUpload(
  presignedUrl: string,
  file: Blob,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("aborted", "Upload cancelled"));
      return;
    }

    const xhr = new XMLHttpRequest();

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag"));
      } else {
        reject(classifyStatus(xhr.status));
      }
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new UploadError("network", "Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new UploadError("aborted", "Upload cancelled"));
    });

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}

// Whether a failure is worth retrying. Aborts and client/quota errors are not.
function isRetryable(err: UploadError): boolean {
  return err.kind === "network" || err.kind === "server";
}

/**
 * Upload a blob to a presigned S3 URL with progress, cancellation, and retry.
 * Resolves with the response ETag (used for multipart completion); throws
 * UploadError on terminal failure.
 */
export async function uploadToS3(
  presignedUrl: string,
  file: Blob,
  options: UploadToS3Options = {}
): Promise<string | null> {
  const { signal, onProgress, maxAttempts = 3 } = options;

  let lastError: UploadError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await attemptUpload(presignedUrl, file, signal, onProgress);
    } catch (err) {
      const uploadErr =
        err instanceof UploadError
          ? err
          : new UploadError("network", err instanceof Error ? err.message : "Upload failed");

      lastError = uploadErr;

      if (!isRetryable(uploadErr) || attempt === maxAttempts) {
        throw uploadErr;
      }

      // Exponential backoff: 500ms, 1s, 2s, ... (aborts during wait reject)
      await delay(500 * 2 ** (attempt - 1), signal);
    }
  }

  throw lastError ?? new UploadError("network", "Upload failed");
}
