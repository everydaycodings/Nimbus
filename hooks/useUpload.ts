import { useUploadStore } from "@/store/uploadStore"
import { getQueryClient } from "@/lib/query-client"
import { generateClientThumbnail } from "@/lib/client-thumbnail"
import { performUpload, MULTIPART_THRESHOLD } from "@/lib/upload/performUpload"

interface UploadOptions {
  parentFolderId?: string
  onSuccess?: (fileId: string) => void
  onError?: (error: string) => void
}

// Per-upload state keyed by the UI tempId, so cancel/cleanup can reach the
// AbortController and the S3 identifiers regardless of which path is running.
const abortControllers = new Map<string, AbortController>()
const uploadMeta = new Map<string, { fileId?: string; uploadId?: string }>()

let fileQueryInvalidationTimer: ReturnType<typeof setTimeout> | null = null
const pendingInvalidationFolders = new Set<string | null>()

// Debounced + targeted: only refresh the folder(s) that received uploads, the
// recent list, and storage stats — not every cached folder/starred/trash view.
function scheduleFileQueryInvalidation(parentFolderId: string | null) {
  pendingInvalidationFolders.add(parentFolderId)

  if (fileQueryInvalidationTimer) {
    clearTimeout(fileQueryInvalidationTimer)
  }

  fileQueryInvalidationTimer = setTimeout(() => {
    fileQueryInvalidationTimer = null
    const qc = getQueryClient()
    const folders = [...pendingInvalidationFolders]
    pendingInvalidationFolders.clear()

    for (const folderId of folders) {
      // Prefix match → covers every filter/sort variant of that folder's list.
      qc.invalidateQueries({ queryKey: ["files", "list", folderId] })
    }
    qc.invalidateQueries({ queryKey: ["files", "recent"] })
    qc.invalidateQueries({ queryKey: ["storage-stats"] })
  }, 400)
}

// Best-effort cleanup of an orphaned upload (S3 object/parts + pending DB row).
async function cleanupOrphan(fileId: string, uploadId?: string) {
  try {
    await fetch("/api/upload/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, uploadId }),
    })
  } catch (e) {
    console.error("Cleanup API failed", e)
  }
}

export function useUpload(options: UploadOptions = {}) {
  const { addUpload, updateUpload, removeUpload, uploads } = useUploadStore()

  const upload = async (file: File, fileIdForVersioning?: string) => {
    const tempId = crypto.randomUUID()
    const controller = new AbortController()
    const meta: { fileId?: string; uploadId?: string } = {}
    abortControllers.set(tempId, controller)
    uploadMeta.set(tempId, meta)

    addUpload({
      id: tempId,
      name: file.name,
      progress: 0,
      status: "uploading",
      fileId: null,
      size: file.size,
      parentFolderId: options.parentFolderId ?? null,
      source: "drive",
      kind: file.size > MULTIPART_THRESHOLD ? "multipart" : "file",
    })

    try {
      const thumbnailBlob = await generateClientThumbnail(file)

      const { fileId } = await performUpload({
        file,
        parentFolderId: options.parentFolderId,
        fileIdForVersioning,
        thumbnailBlob,
        signal: controller.signal,
        onProgress: (progress) => updateUpload(tempId, { progress }),
        onMeta: (m) => {
          meta.fileId = m.fileId
          meta.uploadId = m.uploadId
          updateUpload(tempId, { fileId: m.fileId })
        },
      })

      updateUpload(tempId, { progress: 100, status: "complete" })
      scheduleFileQueryInvalidation(options.parentFolderId ?? null)
      options.onSuccess?.(fileId)

      abortControllers.delete(tempId)
      uploadMeta.delete(tempId)
      setTimeout(() => removeUpload(tempId), 3000)
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : JSON.stringify(err) || "Upload failed"

      const cancelled = message === "Upload cancelled"

      updateUpload(tempId, {
        status: cancelled ? "cancelled" : "error",
        error: message,
      })

      // On a terminal (non-cancel) failure, clean up the orphaned S3
      // object/parts and the pending DB row (which also frees quota).
      if (!cancelled && meta.fileId) {
        cleanupOrphan(meta.fileId, meta.uploadId)
      }

      options.onError?.(message)
      abortControllers.delete(tempId)
      uploadMeta.delete(tempId)
      setTimeout(() => removeUpload(tempId), 3000)
    }
  }

  const uploadMany = (files: FileList | File[]) => {
    Array.from(files).forEach((f) => upload(f))
  }

  // ❌ Cancel upload
  const cancelUpload = async (id: string) => {
    const controller = abortControllers.get(id)
    if (controller) {
      controller.abort()
      abortControllers.delete(id)
    }

    const meta = uploadMeta.get(id)
    const fileId = meta?.fileId ?? uploads.find((u) => u.id === id)?.fileId

    if (fileId) {
      await cleanupOrphan(fileId, meta?.uploadId ?? undefined)
    }

    uploadMeta.delete(id)
    updateUpload(id, { status: "cancelled" })
    setTimeout(() => removeUpload(id), 3000)
  }

  return { upload, uploadMany, cancelUpload }
}
