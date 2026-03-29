// vault/hooks/queries/useVaultQueries.ts
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getVaults } from "@/vault/actions/vault.actions";
import { getVaultFolders, getVaultFilesInFolder } from "@/vault/actions/vault.folders.actions";

export function useVaultsQuery() {
  return useQuery({
    queryKey: queryKeys.vaults(),
    queryFn: async () => {
      return getVaults();
    },
  });
}

export function useVaultItemsQuery(vaultId: string, folderId: string | null) {
  return useQuery({
    queryKey: queryKeys.vaultItems(vaultId, folderId),
    queryFn: async () => {
      const [folders, files] = await Promise.all([
        getVaultFolders(vaultId, folderId),
        getVaultFilesInFolder(vaultId, folderId),
      ]);
      return { folders, files };
    },
    enabled: !!vaultId,
  });
}
