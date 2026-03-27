// hooks/useFolderUpload.ts
"use client";

import { useUploadStore } from "@/store/uploadStore";
import { createFolderForUpload } from "@/actions/uploadFolder";

const xhrMap = new Map<string, XMLHttpRequest>();

interface FolderUploadOptions {
  parentFolderId?: string | null;
  onSuccess?: () => void;
  onError?:   (err: string) => void;
}

export function useFolderUpload(options: FolderUploadOptions = {}) {
  const { addUpload, updateUpload, removeUpload } = useUploadStore();

  // Build a folder path → supabase folder id map as we go
  const folderIdCache = new Map<string, string>();

  // Ensure all ancestor folders exist and return the leaf folder id
  async function ensureFolderPath(
    pathParts: string[],       // e.g. ["photos", "2024", "summer"]
    rootParentId: string | null
  ): Promise<string> {
    let currentParentId = rootParentId ?? null;
    let cacheKey        = "";

    for (const part of pathParts) {
      cacheKey = cacheKey ? `${cacheKey}/${part}` : part;

      if (folderIdCache.has(cacheKey)) {
        currentParentId = folderIdCache.get(cacheKey)!;
        continue;
      }

      const folderId = await createFolderForUpload(part, currentParentId);
      folderIdCache.set(cacheKey, folderId);
      currentParentId = folderId;
    }

    return currentParentId!;
  }

  async function uploadFile(
    file: File,
    parentFolderId: string | null
  ): Promise<void> {
    const tempId = crypto.randomUUID();

    addUpload({
      id:       tempId,
      name:     file.name,
      progress: 0,
      status:   "uploading",
      fileId:   null,
    });

    try {
      // Step 1: Get presigned URL
      const presignRes = await fetch("/api/upload/presign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           file.name,
          mimeType:       file.type || "application/octet-stream",
          size:           file.size,
          parentFolderId: parentFolderId,
        }),
      });

      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => ({}));
        throw new Error(body.error ?? `Presign failed: ${presignRes.status}`);
      }

      const { presignedUrl, fileId } = await presignRes.json();
      updateUpload(tempId, { fileId });

      // Step 2: Upload to S3
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrMap.set(tempId, xhr);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            updateUpload(tempId, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        });

        xhr.addEventListener("load", () => {
          xhrMap.delete(tempId);
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 ${xhr.status}`));
        });

        xhr.addEventListener("error", () => { xhrMap.delete(tempId); reject(new Error("Network error")); });
        xhr.addEventListener("abort", () => { xhrMap.delete(tempId); reject(new Error("Cancelled")); });

        xhr.open("PUT", presignedUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });

      // Step 3: Mark complete
      const completeRes = await fetch("/api/upload/complete", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      if (!completeRes.ok) throw new Error("Failed to finalize upload");

      updateUpload(tempId, { progress: 100, status: "complete" });

      setTimeout(() => removeUpload(tempId), 2000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      updateUpload(tempId, { status: "error" });
      options.onError?.(msg);
    }
  }

  async function uploadFolder(fileList: FileList) {
    // fileList from webkitdirectory contains files with relative paths
    // file.webkitRelativePath = "folderName/sub/file.txt"
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const rootParentId = options.parentFolderId ?? null;

    // Upload files sequentially per folder to avoid race conditions
    // on folder creation, then upload files in parallel within each folder
    const byFolder = new Map<string, File[]>();

    for (const file of files) {
      const parts     = file.webkitRelativePath.split("/");
      const dirParts  = parts.slice(0, -1); // everything except filename
      const dirKey    = dirParts.join("/");
      if (!byFolder.has(dirKey)) byFolder.set(dirKey, []);
      byFolder.get(dirKey)!.push(file);
    }

    // Process folders in order (parents before children)
    const sortedFolders = [...byFolder.keys()].sort();

    for (const dirKey of sortedFolders) {
      const dirFiles  = byFolder.get(dirKey)!;
      const pathParts = dirKey.split("/").filter(Boolean);

      // Create folder hierarchy and get the leaf folder id
      const folderId = pathParts.length > 0
        ? await ensureFolderPath(pathParts, rootParentId)
        : rootParentId;

      // Upload all files in this folder in parallel
      await Promise.allSettled(
        dirFiles.map((file) => uploadFile(file, folderId))
      );
    }

    options.onSuccess?.();
  }

  return { uploadFolder };
}