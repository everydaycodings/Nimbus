// vault/hooks/useVaultDownload.ts
"use client";

import { useState } from "react";
import { decryptFile, decryptBuffer, VAULT_MAX_PREVIEW_FILE_SIZE } from "@/vault/lib/crypto";
import { getVaultDownloadUrl }              from "@/vault/actions/vault.actions";
import { getVaultFolderHierarchy }          from "@/vault/actions/vault.folders.actions";
import { useZippingStore }                  from "@/store/zippingStore";
import JSZip from "jszip";

// Cache to store decrypted preview object URLs to prevent re-downloading/decrypting
const vaultPreviewCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

// ── Can this file be previewed? ───────────────────────────────
// Rules:
//   1. Files above VAULT_MAX_FILE_SIZE → download only (memory safety)
//   2. Video excluded even for small files (too heavy to blob-preview)
//   3. Only images, PDFs, and audio get inline preview
export function canPreviewVaultFile(
  mimeType:     string,
  originalSize: number
): boolean {
  if (originalSize > VAULT_MAX_PREVIEW_FILE_SIZE) return false;
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/")
  );
}

export function useVaultDownload(key: CryptoKey) {
  const [decrypting, setDecrypting] = useState<Set<string>>(new Set());
  const { addZipping, updateZipping, removeZipping } = useZippingStore();

  const download = async (
    fileId:           string,
    fileName:         string,
    originalMimeType: string
  ) => {
    if (decrypting.has(fileId)) return;
    setDecrypting((prev) => new Set(prev).add(fileId));

    try {
      const result = await getVaultDownloadUrl(fileId);
      let decryptedBlob: Blob;

      if (result.isFragmented && result.fragments) {
        // ───────────────── Fragmented Recovery ─────────────────
        const decryptedChunks: ArrayBuffer[] = [];
        for (const fragment of result.fragments) {
            const res = await fetch(fragment.url);
            if (!res.ok) throw new Error(`Failed to fetch fragment ${fragment.chunkIndex}`);
            const encryptedChunk = await res.arrayBuffer();
            const decryptedChunk = await decryptBuffer(new Uint8Array(encryptedChunk), key);
            decryptedChunks.push(decryptedChunk);
        }
        decryptedBlob = new Blob(decryptedChunks, { type: originalMimeType });
      } else if (result.url) {
        // ───────────────── Standard Recovery ─────────────────
        const res = await fetch(result.url);
        if (!res.ok) throw new Error("Failed to fetch file");
        const encryptedBlob = await res.blob();
        decryptedBlob = await decryptFile(encryptedBlob, key, originalMimeType);
      } else {
        throw new Error("Invalid download response");
      }

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
    // Check cache
    const cached = vaultPreviewCache.get(fileId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.url;
    }

    try {
      const result = await getVaultDownloadUrl(fileId);
      let decryptedBlob: Blob;

      if (result.isFragmented && result.fragments) {
        const decryptedChunks: ArrayBuffer[] = [];
        for (const fragment of result.fragments) {
            const res = await fetch(fragment.url);
            if (!res.ok) throw new Error(`Failed to fetch fragment ${fragment.chunkIndex}`);
            const encryptedChunk = await res.arrayBuffer();
            const decryptedChunk = await decryptBuffer(new Uint8Array(encryptedChunk), key);
            decryptedChunks.push(decryptedChunk);
        }
        decryptedBlob = new Blob(decryptedChunks, { type: originalMimeType });
      } else if (result.url) {
        const res = await fetch(result.url);
        const encryptedBlob = await res.blob();
        decryptedBlob = await decryptFile(encryptedBlob, key, originalMimeType);
      } else {
        return null;
      }
      
      const url = URL.createObjectURL(decryptedBlob);
      
      // Store in cache
      vaultPreviewCache.set(fileId, { url, timestamp: Date.now() });
      
      return url;
    } catch {
      return null;
    }
  };

  // Optional: Function to clear cache on vault lock
  const clearPreviewCache = () => {
    vaultPreviewCache.forEach((entry) => URL.revokeObjectURL(entry.url));
    vaultPreviewCache.clear();
  };

  const downloadFolder = async (
    vaultId:    string,
    folderId:   string,
    folderName: string
  ) => {
    if (decrypting.has(folderId)) return;
    setDecrypting((prev) => new Set(prev).add(folderId));

    const downloadId = Math.random().toString(36).substring(7);

    try {
      const hierarchy = await getVaultFolderHierarchy(vaultId, folderId);
      const zip = new JSZip();

      addZipping({
        id: downloadId,
        name: folderName,
        totalFiles: hierarchy.length,
        filesProcessed: 0,
        progress: 0,
        status: "preparing",
      });

      // Download and decrypt files in chunks to avoid overwhelming the browser
      const CHUNK_SIZE = 5;
      let processedCount = 0;

      for (let i = 0; i < hierarchy.length; i += CHUNK_SIZE) {
        const chunk = hierarchy.slice(i, i + CHUNK_SIZE);
        
        updateZipping(downloadId, { status: "zipping" });

        await Promise.all(
          chunk.map(async (file) => {
            const result = await getVaultDownloadUrl(file.id);
            let decryptedBlob: Blob;

            if (result.isFragmented && result.fragments) {
                const decryptedChunks: ArrayBuffer[] = [];
                for (const fragment of result.fragments) {
                    const res = await fetch(fragment.url);
                    if (!res.ok) throw new Error(`Failed to fetch ${file.name} chunk ${fragment.chunkIndex}`);
                    const encryptedChunk = await res.arrayBuffer();
                    const decryptedChunk = await decryptBuffer(new Uint8Array(encryptedChunk), key);
                    decryptedChunks.push(decryptedChunk);
                }
                decryptedBlob = new Blob(decryptedChunks, { type: file.mimeType });
            } else if (result.url) {
                const res = await fetch(result.url);
                if (!res.ok) throw new Error(`Failed to fetch ${file.name}`);
                const encryptedBlob = await res.blob();
                decryptedBlob = await decryptFile(encryptedBlob, key, file.mimeType);
            } else {
                throw new Error(`Invalid download for ${file.name}`);
            }

            zip.file(file.path, decryptedBlob);
            
            processedCount++;
            const progress = Math.round((processedCount / hierarchy.length) * 100);
            updateZipping(downloadId, {
              filesProcessed: processedCount,
              progress,
            });
          })
        );
      }

      updateZipping(downloadId, { status: "downloading" });
      const content = await zip.generateAsync({ type: "blob" });
      const url     = URL.createObjectURL(content);
      const a       = Object.assign(document.createElement("a"), {
        href: url, download: `${folderName}.zip`,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      updateZipping(downloadId, { status: "complete", progress: 100 });
      setTimeout(() => removeZipping(downloadId), 5000);
    } catch (err) {
      console.error("[vault folder download]", err);
      updateZipping(downloadId, { status: "error", error: "Download failed" });
      throw err;
    } finally {
      setDecrypting((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  return { download, downloadFolder, preview, decrypting, clearPreviewCache };
}