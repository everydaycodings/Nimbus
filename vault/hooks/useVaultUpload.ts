// vault/hooks/useVaultUpload.ts
"use client";

import { useState } from "react";
import { encryptFile, VAULT_MAX_FILE_SIZE, VAULT_MAX_FILE_SIZE_LABEL } from "@/vault/lib/crypto";
import { getVaultPresignedUrl, saveVaultFile } from "@/vault/actions/vault.actions";

export interface VaultUploadItem {
  id:       string;
  name:     string;
  progress: number;
  status:   "encrypting" | "uploading" | "complete" | "error";
  error?:   string;
}

export function useVaultUpload(vaultId: string, key: CryptoKey) {
  const [uploads, setUploads] = useState<VaultUploadItem[]>([]);

  const update = (id: string, patch: Partial<VaultUploadItem>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const uploadFile = async (file: File) => {
    const tempId = crypto.randomUUID();

    // ── Size check before doing anything ─────────────────────
    if (file.size > VAULT_MAX_FILE_SIZE) {
      setUploads((prev) => [
        ...prev,
        {
          id:     tempId,
          name:   file.name,
          progress: 0,
          status: "error",
          error:  `File exceeds the ${VAULT_MAX_FILE_SIZE_LABEL} vault limit`,
        },
      ]);
      // Auto-remove the error entry after 5s
      setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== tempId)), 5000);
      return;
    }

    setUploads((prev) => [
      ...prev,
      { id: tempId, name: file.name, progress: 0, status: "encrypting" },
    ]);

    try {
      // Step 1: Encrypt in browser
      const encryptedBlob = await encryptFile(file, key);

      update(tempId, { status: "uploading", progress: 0 });

      // Step 2: Get presigned URL
      const { presignedUrl, s3Key, bucket } = await getVaultPresignedUrl({
        vaultId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size:     encryptedBlob.size,
      });

      // Step 3: Upload to S3 with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            update(tempId, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        });

        xhr.addEventListener("load", () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`S3 upload failed (${xhr.status})`))
        );
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.addEventListener("abort", () => reject(new Error("Cancelled")));

        xhr.open("PUT", presignedUrl);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.send(encryptedBlob);
      });

      // Step 4: Save metadata in Supabase
      await saveVaultFile({
        vaultId,
        name:             file.name,
        originalMimeType: file.type || "application/octet-stream",
        size:             file.size,
        s3Key,
        s3Bucket:         bucket,
      });

      update(tempId, { progress: 100, status: "complete" });
      setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== tempId)), 2000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      update(tempId, { status: "error", error: msg });
    }
  };

  const uploadMany = (files: FileList | File[]) => {
    Array.from(files).forEach(uploadFile);
  };

  return { uploadMany, uploads };
}