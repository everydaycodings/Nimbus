import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { getVaults } from "@/vault/actions/vault.actions";
import { getVaultFolders, getVaultFilesInFolder } from "@/vault/actions/vault.folders.actions";
import { Vault } from "@/vault/types/vault";

export function useVaultsQuery(initialData?: Vault[]) {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channelId = `vaults_realtime_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vaults" },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.vaults() });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  return useQuery({
    queryKey: queryKeys.vaults(),
    queryFn: async () => {
      return getVaults();
    },
    initialData,
  });
}

export function useVaultItemsQuery(vaultId: string, folderId: string | null) {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!vaultId) return;

    const channelId = `vault_items_${vaultId}_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      // Listen for file changes in this vault
      .on(
        "postgres_changes",
        { 
          event: "*", 
          schema: "public", 
          table: "vault_files",
          filter: `vault_id=eq.${vaultId}` 
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(vaultId, folderId) });
        }
      )
      // Listen for folder changes in this vault
      .on(
        "postgres_changes",
        { 
          event: "*", 
          schema: "public", 
          table: "vault_folders",
          filter: `vault_id=eq.${vaultId}` 
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(vaultId, folderId) });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, vaultId, folderId]);

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
