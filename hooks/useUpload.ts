import { useUploadStore } from "@/store/uploadStore";

interface UploadOptions {
  parentFolderId?: string;
  onSuccess?: (fileId: string) => void;
  onError?: (error: string) => void;
}

// 🔥 Store active XHRs for cancel support
const xhrMap = new Map<string, XMLHttpRequest>();

export function useUpload(options: UploadOptions = {}) {
  const { addUpload, updateUpload, removeUpload } = useUploadStore();

  const upload = async (file: File) => {
    const tempId = crypto.randomUUID();

    // ✅ Add to global store
    addUpload({
      id: tempId,
      name: file.name,
      progress: 0,
      status: "uploading",
    });

    try {
      // ── Step 1: Get presigned URL ──
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          parentFolderId: options.parentFolderId,
        }),
      });

      if (!presignRes.ok) {
        const { error } = await presignRes.json();
        throw new Error(error ?? "Failed to get upload URL");
      }

      const { presignedUrl, fileId } = await presignRes.json();

      // ── Step 2: Upload to S3 with cancel support ──
      await uploadToS3(presignedUrl, file, tempId, (progress) => {
        updateUpload(tempId, { progress });
      });

      // ── Step 3: Mark complete ──
      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      if (!completeRes.ok) {
        throw new Error("Failed to finalize upload");
      }

      updateUpload(tempId, {
        progress: 100,
        status: "complete",
      });

      options.onSuccess?.(fileId);

      // auto remove after delay
      setTimeout(() => {
        removeUpload(tempId);
      }, 2000);

    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";

      updateUpload(tempId, {
        status: "error",
      });

      options.onError?.(message);
    }
  };

  const uploadMany = (files: FileList | File[]) => {
    Array.from(files).forEach(upload);
  };

  // ❌ Cancel upload
  const cancelUpload = (id: string) => {
    const xhr = xhrMap.get(id);

    if (xhr) {
      xhr.abort(); // 🔥 real cancel
      xhrMap.delete(id);
    }

    updateUpload(id, { status: "cancelled" });

    setTimeout(() => {
      removeUpload(id);
    }, 1000);
  };

  return { upload, uploadMany, cancelUpload };
}

// ── Upload helper with cancel tracking ──
function uploadToS3(
  presignedUrl: string,
  file: File,
  id: string,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // ✅ Save xhr for cancel
    xhrMap.set(id, xhr);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      xhrMap.delete(id);

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      xhrMap.delete(id);
      reject(new Error("Network error"));
    });

    xhr.addEventListener("abort", () => {
      xhrMap.delete(id);
      reject(new Error("Upload cancelled"));
    });

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.send(file);
  });
}