import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { createVault, deleteVault, renameVaultFile, deleteVaultFile } from "@/vault/actions/vault.actions";
import { 
  createVaultFolder, 
  deleteVaultFolder, 
  renameVaultFolder, 
  moveVaultFile, 
  moveVaultFolder 
} from "@/vault/actions/vault.folders.actions";

export function useCreateVaultMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createVault,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vaults() });
    },
  });
}

export function useDeleteVaultMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vaultId: string) => deleteVault(vaultId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vaults() });
    },
  });
}

export function useCreateVaultFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vaultId, name, parentFolderId }: { vaultId: string; name: string; parentFolderId: string | null }) => 
      createVaultFolder(vaultId, name, parentFolderId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(variables.vaultId, variables.parentFolderId) });
      // Also invalidate parent if needed, but usually vaultItems is enough as it's the current view
    },
  });
}

export function useRenameVaultFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) => 
      renameVaultFolder(folderId, name),
    onSuccess: () => {
      // Since we don't know the vaultId/parentFolderId here easily without extra params,
      // we can invalidate all vault items or require caller to pass them.
      // For simplicity, let's invalidate all vault items for now or better, use a more generic key if available.
      queryClient.invalidateQueries({ queryKey: ["vaults", "items"] });
    },
  });
}

export function useDeleteVaultFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => deleteVaultFolder(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vaults", "items"] });
    },
  });
}

export function useRenameVaultFileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, name }: { fileId: string; name: string }) => 
      renameVaultFile(fileId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vaults", "items"] });
    },
  });
}

export function useDeleteVaultFileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => deleteVaultFile(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vaults", "items"] });
    },
  });
}

export function useMoveVaultItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ items, targetFolderId }: { 
      items: { id: string; type: "file" | "folder" }[]; 
      targetFolderId: string | null 
    }) => {
      for (const item of items) {
        if (item.type === "file") {
          await moveVaultFile(item.id, targetFolderId);
        } else {
          await moveVaultFolder(item.id, targetFolderId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vaults", "items"] });
    },
  });
}
