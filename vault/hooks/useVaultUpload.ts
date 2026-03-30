// vault/hooks/useVaultUpload.ts
"use client"

import { useState } from "react"
import {
  encryptFile,
  VAULT_MAX_FILE_SIZE,
  VAULT_MAX_FILE_SIZE_LABEL,
} from "@/vault/lib/crypto"
import {
  getVaultPresignedUrl,
  saveVaultFile,
} from "@/vault/actions/vault.actions"
import { useUploadStore } from "@/store/uploadStore"

export interface VaultUploadItem {
  id: string
  name: string
  progress: number
  status: "encrypting" | "uploading" | "complete" | "error"
  error?: string
}

export interface VaultUploadOptions {
  parentFolderId?: string | null
  onSuccess?: () => void
}

export function useVaultUpload(vaultId: string, key: CryptoKey, options: VaultUploadOptions = {}) {
  const addUpload = useUploadStore((s) => s.addUpload)
  const updateUpload = useUploadStore((s) => s.updateUpload)
  const removeUpload = useUploadStore((s) => s.removeUpload)

  const uploadFile = async (file: File) => {
    const tempId = crypto.randomUUID()

    // ── Size check before doing anything ─────────────────────
    if (file.size > VAULT_MAX_FILE_SIZE) {
      addUpload({
        id: tempId,
        name: file.name,
        progress: 0,
        status: "error",
        error: `File exceeds the ${VAULT_MAX_FILE_SIZE_LABEL} vault limit`,
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
      // Step 1: Encrypt in browser
      const encryptedBlob = await encryptFile(file, key)

      updateUpload(tempId, {
        progress: 0,
      })

      // Step 2: Get presigned URL
      const { presignedUrl, s3Key, bucket } = await getVaultPresignedUrl({
        vaultId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: encryptedBlob.size,
      })

      // Step 3: Upload to S3 with progress
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

      // Step 4: Save metadata in Supabase
      await saveVaultFile({
        vaultId,
        name: file.name,
        originalMimeType: file.type || "application/octet-stream",
        size: file.size,
        s3Key,
        s3Bucket: bucket,
        parentFolderId: options.parentFolderId,
      })

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
    await Promise.allSettled(Array.from(files).map(uploadFile))
    options.onSuccess?.()
  }

  return { uploadMany }
}
