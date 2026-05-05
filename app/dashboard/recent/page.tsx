// app/(dashboard)/recent/page.tsx
"use client";

import { Clock, Funnel } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { useSearchParams } from "next/navigation";
import { FileFilters } from "@/components/FileFilters";
import { useInfiniteRecentFilesQuery } from "@/hooks/queries/useInfiniteRecentFilesQuery";
import { InfiniteScrollTrigger } from "@/components/InfiniteScrollTrigger";
import { useCallback } from "react";

export default function RecentPage() {
  const searchParams = useSearchParams();

  const type = searchParams.get("type") || "all";
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;
  const tagId = searchParams.get("tagId") || undefined;

  const queryOptions = {
    type,
    sortBy,
    sortOrder,
    minSize,
    maxSize,
    tagId,
  };

  const {
    data,
    isLoading: loading,
    refetch: refresh,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteRecentFilesQuery(queryOptions);
  const files = (data?.pages ?? []).flatMap((page) => (page?.files ?? []) as any[]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className="flex flex-col h-full p-4 md:p-6">
      <div className="flex items-center gap-2 mb-6">
        <Clock size={20} weight="duotone" className="text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Recent</h1>
      </div>

      <FileFilters />

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Funnel size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No files match your filters</p>
        </div>
      ) : (
        <>
          <FileGrid
            files={files}
            folders={[]}
            onRefresh={refresh}
          />
          <InfiniteScrollTrigger
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
            onLoadMore={loadMore}
          />
        </>
      )}
    </div>
  );
}
