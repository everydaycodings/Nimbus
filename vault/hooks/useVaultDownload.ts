// vault/hooks/useVaultDownload.ts
"use client";

import { useState } from "react";
import { decryptFile, VAULT_MAX_FILE_SIZE } from "@/vault/lib/crypto";
import { getVaultDownloadUrl }              from "@/vault/actions/vault.actions";

// ── Can this file be previewed? ───────────────────────────────
// Rules:
//   1. Files above VAULT_MAX_FILE_SIZE → download only (memory safety)
//   2. Video excluded even for small files (too heavy to blob-preview)
//   3. Only images, PDFs, and audio get inline preview
export function canPreviewVaultFile(
  mimeType:     string,
  originalSize: number
): boolean {
  if (originalSize > VAULT_MAX_FILE_SIZE) return false;
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("audio/")
  );
}

export function useVaultDownload(key: CryptoKey) {
  const [decrypting, setDecrypting] = useState<Set<string>>(new Set());

  const download = async (
    fileId:           string,
    fileName:         string,
    originalMimeType: string
  ) => {
    if (decrypting.has(fileId)) return;
    setDecrypting((prev) => new Set(prev).add(fileId));

    try {
      const signedUrl     = await getVaultDownloadUrl(fileId);
      const res           = await fetch(signedUrl);
      if (!res.ok) throw new Error("Failed to fetch file");
      const encryptedBlob = await res.blob();
      const decryptedBlob = await decryptFile(encryptedBlob, key, originalMimeType);

      const url = URL.createObjectURL(decryptedBlob);
      const a   = Object.assign(document.createElement("a"), {
        href: url, download: fileName,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("[vault download]", err);
      throw err;
    } finally {
      setDecrypting((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  };

  // Only call this when canPreviewVaultFile() returns true
  const preview = async (
    fileId:           string,
    originalMimeType: string
  ): Promise<string | null> => {
    try {
      const signedUrl     = await getVaultDownloadUrl(fileId);
      const res           = await fetch(signedUrl);
      const encryptedBlob = await res.blob();
      const decryptedBlob = await decryptFile(encryptedBlob, key, originalMimeType);
      return URL.createObjectURL(decryptedBlob);
    } catch {
      return null;
    }
  };

  return { download, preview, decrypting };
}