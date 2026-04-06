"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { getActivityLogs } from "@/actions/activity";
import { queryKeys } from "@/lib/query-keys";

export function useActivityLogsQuery(page = 1, limit = 20) {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channelId = `activity_log_changes_${Math.random().toString(36).substring(7)}`;
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
          queryClient.invalidateQueries({ queryKey: ["activity", "logs"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  return useQuery({
    queryKey: queryKeys.activity(page, limit),
    queryFn: () => getActivityLogs(page, limit),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
