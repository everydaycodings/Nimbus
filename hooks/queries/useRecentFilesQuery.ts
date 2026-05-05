// hooks/queries/useRecentFilesQuery.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { getRecentFiles } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";

interface RecentQueryOptions {
  page?: number;
  type?: string;
  sortBy?: string;
  sortOrder?: string;
  minSize?: number;
  maxSize?: number;
  tagId?: string;
}

export function useRecentFilesQuery(options?: RecentQueryOptions) {
  return useQuery({
    queryKey: queryKeys.recent(options),
    queryFn: () => getRecentFiles(options),
  });
}
