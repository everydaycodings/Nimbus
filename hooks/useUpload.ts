// hooks/useUpload.ts
import { useState } from "react";

interface UploadOptions {
  parentFolderId?: string;
  onSuccess?: (fileId: string) => void;
  onError?: (error: string) => void;
}

interface UploadingFile {
  id:       string;
  name:     string;
  progress: number;
  status:   "uploading" | "complete" | "error";
}

export function useUpload(options: UploadOptions = {}) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const updateFile = (id: string, patch: Partial<UploadingFile>) => {
    setUploadingFiles(prev =>
      prev.map(f => (f.id === id ? { ...f, ...patch } : f))
    );
  };

  const upload = async (file: File) => {
    const tempId = crypto.randomUUID();

    setUploadingFiles(prev => [
      ...prev,
      { id: tempId, name: file.name, progress: 0, status: "uploading" },
    ]);

    try {
      // Step 1: Get presigned URL
      const presignRes = await fetch("/api/upload/presign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           file.name,
          mimeType:       file.type || "application/octet-stream",
          size:           file.size,
          parentFolderId: options.parentFolderId,
        }),
      });

      if (!presignRes.ok) {
        const { error } = await presignRes.json();
        throw new Error(error ?? "Failed to get upload URL");
      }

      const { presignedUrl, fileId } = await presignRes.json();

      // Step 2: Upload directly to S3 with progress tracking
      await uploadToS3(presignedUrl, file, (progress) => {
        updateFile(tempId, { progress });
      });

      // Step 3: Mark complete in Supabase
      const completeRes = await fetch("/api/upload/complete", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      if (!completeRes.ok) {
        throw new Error("Failed to finalize upload");
      }

      updateFile(tempId, { progress: 100, status: "complete" });
      options.onSuccess?.(fileId);

      setTimeout(() => {
        setUploadingFiles(prev => prev.filter(f => f.id !== tempId));
      }, 2000);

    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      updateFile(tempId, { status: "error" });
      options.onError?.(message);
    }
  };

  const uploadMany = (files: FileList | File[]) => {
    Array.from(files).forEach(upload);
  };

  return { upload, uploadMany, uploadingFiles };
}

function uploadToS3(
  presignedUrl: string,
  file: File,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}