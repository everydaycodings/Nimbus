// hooks/queries/useFilesQuery.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { getFiles } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";

interface FileQueryOptions {
  page?: number;
  query?: string;
  type?: string;
  sortBy?: string;
  sortOrder?: string;
  minSize?: number;
  maxSize?: number;
  tagId?: string;
}

export function useFilesQuery(
  parentFolderId: string | null = null,
  options?: FileQueryOptions
) {
  return useQuery({
    queryKey: queryKeys.files(parentFolderId, options),
    queryFn: () => getFiles(parentFolderId, options),
  });
}
