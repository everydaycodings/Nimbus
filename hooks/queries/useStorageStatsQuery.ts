// hooks/queries/useStorageStatsQuery.ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { getStorageStats } from "@/actions/files";

export function useStorageStatsQuery() {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Listen for any change on the files table to keep storage stats in sync
    const channelId = `storage_stats_realtime_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "*", // Listen for ALL events (insert, update, delete)
          schema: "public",
          table: "files",
        },
        () => {
          // Invalidate the stats query only
          queryClient.invalidateQueries({ queryKey: ["storage-stats"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  return useQuery({
    queryKey: ["storage-stats"],
    queryFn: () => getStorageStats(),
    staleTime: 1000 * 60 * 5, // 5 minutes (but invalidated by realtime)
  });
}
