import type { PhotosResponse } from "@nimbus/shared/api"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"

import { useApi } from "./files"

// Every photo and video of mine, newest taken first. The pages load one after another in the
// background, so the grid, the fast scroller and the slideshow all see the whole library.
// Not saved to disk like the file lists: it is thumbnails of everything, and needs the server anyway.
export function usePhotos() {
  const api = useApi()
  const query = useInfiniteQuery({
    queryKey: [api.id, "photos"],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PhotosResponse) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) => api.get<PhotosResponse>(`/photos?limit=500${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
  })
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  return { ...query, items, total: query.data?.pages[0]?.total ?? 0 }
}

// Thumbnail address for a tile, with the sign-in header expo-image needs.
export const thumbSource = (account: { server: string; token: string }, p: { id: string; version: string | null; thumb: string | null }) => ({
  uri: `${account.server}/api/files/${p.id}/thumb?v=${p.version}&r=${p.thumb}`,
  headers: { authorization: `Bearer ${account.token}` },
})
