"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getActivityLogs } from "@/actions/activity";
import { queryKeys } from "@/lib/query-keys";

export function useActivityLogsQuery(limit = 20) {
  const queryClient = useQueryClient();
  const supabase = createClient();

  useEffect(() => {
    const channelId = `activity_log_changes_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_log",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.activity() });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  return useQuery({
    queryKey: queryKeys.activity(),
    queryFn: () => getActivityLogs(limit),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
