// hooks/mutations/useFileMutations.ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  toggleStar,
  trashItem,
  restoreItem,
  renameItem,
} from "@/actions/files";
import { createFolder, moveFile, moveFolder } from "@/actions/folders";
import { emptyTrash, deleteItemPermanently } from "@/actions/trash";
import { queryKeys } from "@/lib/query-keys";

/** Invalidate all file/folder queries across the app */
function useInvalidateFiles() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.all });
}

// ── Star / Unstar ──────────────────────────────────────────────
export function useStarMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({
      id,
      type,
      starred,
    }: {
      id: string;
      type: "file" | "folder";
      starred: boolean;
    }) => toggleStar(id, type, starred),
    onSuccess: invalidate,
  });
}

// ── Move to trash ──────────────────────────────────────────────
export function useTrashMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: "file" | "folder" | "version" }) =>
      trashItem(id, type),
    onSuccess: invalidate,
  });
}

// ── Restore from trash ─────────────────────────────────────────
export function useRestoreMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: "file" | "folder" | "version" }) =>
      restoreItem(id, type),
    onSuccess: invalidate,
  });
}

// ── Rename ─────────────────────────────────────────────────────
export function useRenameMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({
      id,
      type,
      name,
    }: {
      id: string;
      type: "file" | "folder";
      name: string;
    }) => renameItem(id, type, name),
    onSuccess: invalidate,
  });
}

// ── Create folder ──────────────────────────────────────────────
export function useCreateFolderMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({
      name,
      parentFolderId,
    }: {
      name: string;
      parentFolderId: string | null;
    }) => createFolder(name, parentFolderId),
    onSuccess: invalidate,
  });
}

// ── Move file ──────────────────────────────────────────────────
export function useMoveFileMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({
      fileId,
      targetFolderId,
    }: {
      fileId: string;
      targetFolderId: string | null;
    }) => moveFile(fileId, targetFolderId),
    onSuccess: invalidate,
  });
}

// ── Move folder ────────────────────────────────────────────────
export function useMoveFolderMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({
      folderId,
      targetFolderId,
    }: {
      folderId: string;
      targetFolderId: string | null;
    }) => moveFolder(folderId, targetFolderId),
    onSuccess: invalidate,
  });
}

// ── Empty trash ────────────────────────────────────────────────
export function useEmptyTrashMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: invalidate,
  });
}

// ── Delete permanently ─────────────────────────────────────────
export function useDeletePermanentlyMutation() {
  const invalidate = useInvalidateFiles();

  return useMutation({
    mutationFn: ({
      id,
      type,
    }: {
      id: string;
      type: "file" | "folder" | "version";
    }) => deleteItemPermanently(id, type),
    onSuccess: invalidate,
  });
}
