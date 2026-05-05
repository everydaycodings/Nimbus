"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { getRecentFiles } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";

interface RecentQueryOptions {
  type?: string;
  sortBy?: string;
  sortOrder?: string;
  minSize?: number;
  maxSize?: number;
  tagId?: string;
}

export function useInfiniteRecentFilesQuery(options?: RecentQueryOptions) {
  return useInfiniteQuery({
    queryKey: queryKeys.recent(options),
    queryFn: ({ pageParam }) => getRecentFiles({ ...options, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const pagination = lastPage?.pagination;
      if (!pagination || pagination.page >= pagination.totalPages) return undefined;
      return pagination.page + 1;
    },
  });
}
