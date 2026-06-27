// lib/upload/multipartUpload.ts
// Client-side driver for S3 multipart uploads: slices the file, uploads parts
// with bounded concurrency + per-part retry (via uploadToS3), aggregates
// progress, and returns the completed parts (PartNumber + ETag) for the
// CompleteMultipartUpload call.

import { uploadToS3, UploadError } from "./uploadToS3";

export interface PartUrl {
  partNumber: number;
  url: string;
}

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

interface UploadPartsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void; // aggregate 0-100
  concurrency?: number;
}

export async function uploadParts(
  file: File,
  partSize: number,
  partUrls: PartUrl[],
  options: UploadPartsOptions = {}
): Promise<CompletedPart[]> {
  const { signal, onProgress, concurrency = 4 } = options;
  const totalBytes = file.size;
  const partBytesDone = new Array(partUrls.length).fill(0);
  const completed: CompletedPart[] = new Array(partUrls.length);

  const reportProgress = () => {
    if (!onProgress) return;
    const uploaded = partBytesDone.reduce((a, b) => a + b, 0);
    onProgress(Math.min(100, Math.round((uploaded / totalBytes) * 100)));
  };

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= partUrls.length) return;
      if (signal?.aborted) throw new UploadError("aborted", "Upload cancelled");

      const { partNumber, url } = partUrls[i];
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, totalBytes);
      const blob = file.slice(start, end);
      const partBytes = end - start;

      const etag = await uploadToS3(url, blob, {
        signal,
        onProgress: (pct) => {
          partBytesDone[i] = (pct / 100) * partBytes;
          reportProgress();
        },
      });

      if (!etag) {
        throw new UploadError("server", `Missing ETag for part ${partNumber}`);
      }

      completed[i] = { PartNumber: partNumber, ETag: etag };
      partBytesDone[i] = partBytes;
      reportProgress();
    }
  };

  const workerCount = Math.min(concurrency, partUrls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return completed;
}
