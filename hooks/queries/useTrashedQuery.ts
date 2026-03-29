// hooks/queries/useTrashedQuery.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { getTrashedItems } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";

export function useTrashedQuery() {
  return useQuery({
    queryKey: queryKeys.trash(),
    queryFn: () => getTrashedItems(),
  });
}
