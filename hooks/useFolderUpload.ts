// hooks/useFolderUpload.ts
"use client";

import { useUploadStore } from "@/store/uploadStore";
import { createFolderForUpload } from "@/actions/uploadFolder";
import { generateClientThumbnail } from "@/lib/client-thumbnail";
import { getQueryClient } from "@/lib/query-client";
import { performUpload, MULTIPART_THRESHOLD } from "@/lib/upload/performUpload";

interface FolderUploadOptions {
  parentFolderId?: string | null;
  onSuccess?: () => void;
  onError?:   (err: string) => void;
}

export function useFolderUpload(options: FolderUploadOptions = {}) {
  const { addUpload, updateUpload, removeUpload } = useUploadStore();

  // Build a folder path → supabase folder id map as we go
  const folderIdCache = new Map<string, string>();

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
      size:     file.size,
      parentFolderId,
      source:   "drive",
      kind:     file.size > MULTIPART_THRESHOLD ? "multipart" : "file",
    });

    try {
      const thumbnailBlob = await generateClientThumbnail(file);

      // Shared upload core → large files in folders now use multipart + retry.
      await performUpload({
        file,
        parentFolderId,
        thumbnailBlob,
        onProgress: (progress) => updateUpload(tempId, { progress }),
        onMeta: (m) => updateUpload(tempId, { fileId: m.fileId }),
      });

      updateUpload(tempId, { progress: 100, status: "complete" });
      setTimeout(() => removeUpload(tempId), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      updateUpload(tempId, { status: "error", error: msg });
      options.onError?.(msg);
    }
  }

  const dirKeyOf = (file: File) =>
    file.webkitRelativePath.split("/").slice(0, -1).join("/");

  async function uploadFolder(fileList: FileList) {
    // fileList from webkitdirectory contains files with relative paths
    // file.webkitRelativePath = "folderName/sub/file.txt"
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const rootParentId = options.parentFolderId ?? null;

    // 1. Collect every unique directory path (including ancestors).
    const allDirs = new Set<string>();
    for (const file of files) {
      const parts = dirKeyOf(file).split("/").filter(Boolean);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        allDirs.add(acc);
      }
    }

    // 2. Create folders level by level (shallow first). Within a depth level
    //    all parents already exist, so siblings are created concurrently —
    //    much faster than the old per-file sequential creation, and still
    //    race-free (each path is unique).
    const byDepth = new Map<number, string[]>();
    for (const dir of allDirs) {
      const depth = dir.split("/").length;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth)!.push(dir);
    }

    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      await Promise.all(
        byDepth.get(depth)!.map(async (dirPath) => {
          const parts = dirPath.split("/");
          const name = parts[parts.length - 1];
          const parentPath = parts.slice(0, -1).join("/");
          const parentId = parentPath ? folderIdCache.get(parentPath)! : rootParentId;
          const id = await createFolderForUpload(name, parentId);
          folderIdCache.set(dirPath, id);
        })
      );
    }

    // 3. Upload all files with bounded concurrency (each uploadFile handles its
    //    own errors and reflects them per-item in the upload toast).
    const tasks = files.map((file) => {
      const dirKey = dirKeyOf(file);
      const folderId = dirKey ? folderIdCache.get(dirKey)! : rootParentId;
      return () => uploadFile(file, folderId);
    });

    await runWithConcurrency(tasks, 4);

    // New files/folders appear across many parent lists; refresh folder lists +
    // recent + storage, but not unaffected starred/trash/version views.
    const qc = getQueryClient();
    qc.invalidateQueries({ queryKey: ["files", "list"] });
    qc.invalidateQueries({ queryKey: ["files", "recent"] });
    qc.invalidateQueries({ queryKey: ["storage-stats"] });
    options.onSuccess?.();
  }

  return { uploadFolder };
}

// Run async tasks with a bounded number running at once.
async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      await tasks[i]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  );
}
