// vault/hooks/useVaultUpload.ts
"use client"

import { useState } from "react"
import {
  encryptFile,
  encryptBuffer,
  VAULT_MAX_FILE_SIZE,
  VAULT_MAX_FILE_SIZE_LABEL,
  VAULT_FRAGMENTED_MAX_FILE_SIZE,
  FRAGMENT_SIZE,
} from "@/vault/lib/crypto"
import {
  getVaultPresignedUrl,
  saveVaultFile,
} from "@/vault/actions/vault.actions"
import { useUploadStore } from "@/store/uploadStore"
import { generateClientThumbnail } from "@/lib/client-thumbnail"

export interface VaultUploadItem {
  id: string
  name: string
  progress: number
  status: "encrypting" | "uploading" | "complete" | "error" | "cancelled"
  error?: string
}

export interface VaultUploadOptions {
  parentFolderId?: string | null
  isFragmented?: boolean
  onSuccess?: () => void
}

export function useVaultUpload(vaultId: string, key: CryptoKey, options: VaultUploadOptions = {}) {
  const addUpload = useUploadStore((s) => s.addUpload)
  const updateUpload = useUploadStore((s) => s.updateUpload)
  const removeUpload = useUploadStore((s) => s.removeUpload)
  const uploads = useUploadStore((s) => s.uploads)

  const uploadFile = async (file: File, id?: string) => {
    const tempId = crypto.randomUUID()

    // ── Size check before doing anything ─────────────────────
    const maxSize = options.isFragmented ? VAULT_FRAGMENTED_MAX_FILE_SIZE : VAULT_MAX_FILE_SIZE;
    const maxSizeLabel = options.isFragmented ? "50 MB" : VAULT_MAX_FILE_SIZE_LABEL;

    if (file.size > maxSize) {
      addUpload({
        id: tempId,
        name: file.name,
        progress: 0,
        status: "error",
        error: `File exceeds the ${maxSizeLabel} vault limit`,
        source: "vault",
      })
      
      setTimeout(() => removeUpload(tempId), 3000)
      return
    }

    addUpload({
      id: tempId,
      name: file.name,
      progress: 0,
      status: "uploading", // UploadToast expects this
      source: "vault", // For differentiating from other upload types
    })

    try {
      const chunkCount = Math.ceil(file.size / FRAGMENT_SIZE);
      if (options.isFragmented && chunkCount > 1) {
        
        // 1. Get presigned URLs for all fragments
        const { presignedUrl: manifestUrl, s3Key: manifestKey, bucket, chunks } = await getVaultPresignedUrl({
            vaultId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size, // this is original size, we store it in manifest/file record
            chunkCount
        });

        if (!chunks || chunks.length === 0) throw new Error("Failed to generate fragment URLs");

        const uploadedChunks: Array<{ s3Key: string, size: number, chunkIndex: number, hash?: string }> = [];

        // 2. Process and upload each fragment
        for (let i = 0; i < chunks.length; i++) {
            const chunkInfo = chunks[i];
            const start = i * FRAGMENT_SIZE;
            const end = Math.min(start + FRAGMENT_SIZE, file.size);
            const slice = file.slice(start, end);
            
            updateUpload(tempId, { status: "encrypting" });
            const encryptedChunk = await encryptBuffer(await slice.arrayBuffer(), key);

            updateUpload(tempId, { status: "uploading" });

            // Simple sequential upload for fragments to keep it reliable
            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.upload.addEventListener("progress", (e) => {
                    if (e.lengthComputable) {
                        const baseProgress = (i / chunkCount) * 100;
                        const chunkProgress = (e.loaded / e.total) * (100 / chunkCount);
                        updateUpload(tempId, { progress: Math.round(baseProgress + chunkProgress) });
                    }
                });
                xhr.addEventListener("load", () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Fragment ${i} failed`)));
                xhr.addEventListener("error", () => reject(new Error("Fragment network error")));
                xhr.open("PUT", chunkInfo.presignedUrl);
                xhr.setRequestHeader("Content-Type", "application/octet-stream");
                xhr.send(encryptedChunk.buffer as ArrayBuffer);
            });

            uploadedChunks.push({
                s3Key: chunkInfo.s3Key,
                size: encryptedChunk.byteLength,
                chunkIndex: i
            });
        }

        // 3. Save metadata including fragments
        await saveVaultFile({
            vaultId,
            name: file.name,
            originalMimeType: file.type || "application/octet-stream",
            size: file.size,
            s3Key: manifestKey, // using manifest key as the main entry
            s3Bucket: bucket,
            parentFolderId: options.parentFolderId,
            isFragmented: true,
            chunkCount,
            chunks: uploadedChunks,
            id // Pass original ID for upsert
        });

      } else {
        // ───────────────── Standard Vault Upload Flow ─────────────────
        // Step 1: Encrypt in browser
        const encryptedBlob = await encryptFile(file, key)

        updateUpload(tempId, {
            progress: 0,
        })

        // Step 2: Generate and encrypt thumbnail if possible
        let thumbKey = null;
        let thumbUploadPromise = null;

        const thumbnailBlob = await generateClientThumbnail(file);
        
        // Step 3: Get presigned URLs
        const { presignedUrl, s3Key, bucket, thumbnail } = await getVaultPresignedUrl({
            vaultId,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: encryptedBlob.size,
            includeThumbnail: !!thumbnailBlob,
        })

        if (thumbnailBlob && thumbnail) {
            thumbKey = thumbnail.s3Key;
            const encryptedThumb = await encryptBuffer(await thumbnailBlob.arrayBuffer(), key);
            
            thumbUploadPromise = fetch(thumbnail.presignedUrl, {
                method: "PUT",
                body: encryptedThumb as any,
                headers: { "Content-Type": "application/octet-stream" },
            });
        }

        // Step 4: Upload main file to S3 with progress
        await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest()

            xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
                updateUpload(tempId, {
                progress: Math.round((e.loaded / e.total) * 100),
                })
            }
            })

            xhr.addEventListener("load", () =>
            xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error(`Upload failed (${xhr.status} ${xhr.statusText})`))
            )
            xhr.addEventListener("error", () => reject(new Error("Network error")))
            xhr.addEventListener("abort", () => reject(new Error("Cancelled")))

            xhr.open("PUT", presignedUrl)
            xhr.setRequestHeader("Content-Type", "application/octet-stream")
            xhr.send(encryptedBlob)
        })

        // Step 5: Save metadata in Supabase
        // Wait for thumbnail upload if it exists
        if (thumbUploadPromise) {
            await thumbUploadPromise;
        }

        await saveVaultFile({
            vaultId,
            name: file.name,
            originalMimeType: file.type || "application/octet-stream",
            size: file.size,
            s3Key,
            s3Bucket: bucket,
            thumbnailKey: thumbKey,
            parentFolderId: options.parentFolderId,
            id // Pass original ID for upsert
        })
      }

      updateUpload(tempId, {
        progress: 100,
        status: "complete",
      })
      setTimeout(() => removeUpload(tempId), 3000)
    } catch (err) {
      const msg =
  typeof err === "string"
    ? err
    : err instanceof Error
    ? err.message
    : JSON.stringify(err) || "Upload failed"
      updateUpload(tempId, {
        status: "error",
        error: msg, // 🔥 THIS IS STEP 2
      })
    }
  }

  const uploadMany = async (files: FileList | File[]) => {
    await Promise.allSettled(Array.from(files).map((f) => uploadFile(f)))
    options.onSuccess?.()
  }

  return { uploadFile, uploadMany }
}
