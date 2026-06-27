"use client";

import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { getFiles } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";

interface FileQueryOptions {
  query?: string;
  type?: string;
  sortBy?: string;
  sortOrder?: string;
  minSize?: number;
  maxSize?: number;
  tagId?: string;
}

export function useInfiniteFilesQuery(
  parentFolderId: string | null = null,
  options?: FileQueryOptions,
  initialData?: any
) {
  return useInfiniteQuery({
    queryKey: queryKeys.files(parentFolderId, options),
    queryFn: ({ pageParam }) => getFiles(parentFolderId, { ...options, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const pagination = lastPage?.pagination;
      if (!pagination || pagination.page >= pagination.totalPages) return undefined;
      return pagination.page + 1;
    },
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    // Keep the previous folder's contents visible while the next folder loads
    // so navigation doesn't flash an empty grid.
    placeholderData: keepPreviousData,
  });
}
