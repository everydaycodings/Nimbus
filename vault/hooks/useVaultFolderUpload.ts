// vault/hooks/useVaultFolderUpload.ts
// Uploads an entire folder (including nested subfolders) to a vault.
// Creates vault_folder rows in Supabase for each directory,
// then encrypts and uploads each file into the correct folder.
"use client";

import { useVaultUpload }    from "@/vault/hooks/useVaultUpload";
import { createVaultFolder } from "@/vault/actions/vault.folders.actions";

interface FolderUploadOptions {
  vaultId:        string;
  cryptoKey:      CryptoKey;
  parentFolderId?: string | null;
  onSuccess?:     () => void;
}

export function useVaultFolderUpload({
  vaultId,
  cryptoKey,
  parentFolderId = null,
  onSuccess,
}: FolderUploadOptions) {
  // Re-use the existing single-file upload hook
  const { uploadMany } = useVaultUpload(vaultId, cryptoKey);

  // Cache folder path → vault_folder id to avoid duplicate creates
  const folderIdCache = new Map<string, string>();

  async function ensureFolderPath(
    pathParts:    string[],
    rootParentId: string | null
  ): Promise<string> {
    let currentParentId = rootParentId;
    let cacheKey        = "";

    for (const part of pathParts) {
      cacheKey = cacheKey ? `${cacheKey}/${part}` : part;

      if (folderIdCache.has(cacheKey)) {
        currentParentId = folderIdCache.get(cacheKey)!;
        continue;
      }

      const folderId = await createVaultFolder(vaultId, part, currentParentId);
      folderIdCache.set(cacheKey, folderId);
      currentParentId = folderId;
    }

    return currentParentId!;
  }

  async function uploadFolder(fileList: FileList) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    // Group files by their directory path
    const byDir = new Map<string, File[]>();

    for (const file of files) {
      // webkitRelativePath = "FolderName/sub/file.txt"
      const parts  = file.webkitRelativePath.split("/");
      const dirKey = parts.slice(0, -1).join("/");
      if (!byDir.has(dirKey)) byDir.set(dirKey, []);
      byDir.get(dirKey)!.push(file);
    }

    // Sort so parent dirs are created before children
    const sortedDirs = [...byDir.keys()].sort();

    for (const dirKey of sortedDirs) {
      const dirFiles  = byDir.get(dirKey)!;
      const pathParts = dirKey.split("/").filter(Boolean);

      // Ensure folder hierarchy exists in Supabase
      let targetFolderId: string | null = parentFolderId ?? null;
      if (pathParts.length > 0) {
        targetFolderId = await ensureFolderPath(pathParts, parentFolderId ?? null);
      }

      // Upload all files in this dir with the correct parent folder
      // We need to temporarily override parentFolderId per file.
      // useVaultUpload doesn't accept per-file folder IDs, so we call
      // the upload directly with a custom approach:
      await uploadFilesInFolder(dirFiles, targetFolderId, cryptoKey, vaultId);
    }

    onSuccess?.();
  }

  return { uploadFolder };
}

// ── Upload files into a specific vault folder ─────────────────
// Separated so it can call the presign endpoint with the right folderId.
async function uploadFilesInFolder(
    files: File[],
    parentFolderId: string | null,
    key: CryptoKey,
    vaultId: string
  ): Promise<void> {
    const { encryptFile, VAULT_MAX_FILE_SIZE, VAULT_MAX_FILE_SIZE_LABEL } =
      await import("@/vault/lib/crypto");
  
    const { getVaultPresignedUrl, saveVaultFile } =
      await import("@/vault/actions/vault.actions");
  
    const { useUploadStore } = await import("@/store/uploadStore");
  
    const addUpload = useUploadStore.getState().addUpload;
    const updateUpload = useUploadStore.getState().updateUpload;
    const removeUpload = useUploadStore.getState().removeUpload;
  
    await Promise.allSettled(
      files.map(async (file) => {
        const tempId = crypto.randomUUID();
  
        // ❌ Size check
        if (file.size > VAULT_MAX_FILE_SIZE) {
          addUpload({
            id: tempId,
            name: file.name,
            progress: 0,
            status: "error",
            error: `File exceeds ${VAULT_MAX_FILE_SIZE_LABEL}`,
            source: "vault",
          });
  
          setTimeout(() => removeUpload(tempId), 3000);
          return;
        }
  
        // ✅ Add to UploadToast
        addUpload({
          id: tempId,
          name: file.name,
          progress: 0,
          status: "uploading",
          source: "vault",
        });
  
        try {
          // 🔐 Encrypt
          const encryptedBlob = await encryptFile(file, key);
  
          // 📡 Presign
          const { presignedUrl, s3Key, bucket } =
            await getVaultPresignedUrl({
              vaultId,
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              size: encryptedBlob.size,
            });
  
          // 🚀 Upload with progress
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
  
            xhr.upload.addEventListener("progress", (e) => {
              if (e.lengthComputable) {
                updateUpload(tempId, {
                  progress: Math.round((e.loaded / e.total) * 100),
                });
              }
            });
  
            xhr.addEventListener("load", () =>
              xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error(`Upload failed (${xhr.status})`))
            );
  
            xhr.addEventListener("error", () =>
              reject(new Error("Network error"))
            );
  
            xhr.open("PUT", presignedUrl);
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            xhr.send(encryptedBlob);
          });
  
          // 💾 Save metadata
          await saveVaultFile({
            vaultId,
            name: file.name,
            originalMimeType: file.type || "application/octet-stream",
            size: file.size,
            s3Key,
            s3Bucket: bucket,
            parentFolderId,
          });
  
          // ✅ Complete
          updateUpload(tempId, {
            progress: 100,
            status: "complete",
          });
  
          setTimeout(() => removeUpload(tempId), 3000);
        } catch (err) {
          const msg =
            typeof err === "string"
              ? err
              : err instanceof Error
              ? err.message
              : "Upload failed";
  
          updateUpload(tempId, {
            status: "error",
            error: msg,
          });
        }
      })
    );
  }