// hooks/queries/useStarredQuery.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { getStarredItems } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";

interface StarredQueryOptions {
  tagId?: string;
}

export function useStarredQuery(options?: StarredQueryOptions) {
  return useQuery({
    queryKey: queryKeys.starred(options),
    queryFn: () => getStarredItems(options),
  });
}
