import type { AlbumResponse, AlbumsResponse, MemoriesResponse, MemoryHidesResponse, NewMemoryHide, PartnerResponse, PhotosResponse, PlacesResponse, SmartGroup } from "@nimbus/shared/api"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo } from "react"

import { useSnack } from "@/components/snackbar"

import { errorText } from "./api"
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

// Every page of a photo list, loaded one after another in the background like usePhotos.
function useAllPages(key: unknown[], path: string) {
  const api = useApi()
  const query = useInfiniteQuery({
    queryKey: [api.id, ...key],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PhotosResponse) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) => api.get<PhotosResponse>(`${path}${path.includes("?") ? "&" : "?"}limit=500${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
  })
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  return { ...query, items, total: query.data?.pages[0]?.total ?? 0 }
}

// Screenshots, Documents, Receipts or Videos: the worker's smart groups.
export const useSmart = (group: SmartGroup) => useAllPages(["photos", "smart", group], `/photos/smart/${group}`)

// The phone's own date, "2026-11-12": what On this day is asked for.
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// This month and day in past years. `on` is for tests and the slideshow's param.
export function useMemories(on?: string) {
  const api = useApi()
  const date = on ?? localDate()
  return useQuery({ queryKey: [api.id, "memories", date], queryFn: () => api.get<MemoriesResponse>(`/photos/memories?date=${date}`), staleTime: 60_000 })
}

export function useHides() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "memory-hides"], queryFn: () => api.get<MemoryHidesResponse>("/photos/hides") })
}

// My own photos that have a location. Only asked for once the map is known to be there.
export function usePlaces(enabled: boolean) {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "places"], enabled, queryFn: () => api.get<PlacesResponse>("/photos/places"), select: (d) => d.points })
}

export function useAlbums() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "albums"], queryFn: () => api.get<AlbumsResponse>("/albums"), select: (d) => d.albums })
}

export function useAlbum(id: string) {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "albums", id], queryFn: () => api.get<AlbumResponse>(`/albums/${id}`) })
}

export function usePartner() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "partner"], queryFn: () => api.get<PartnerResponse>("/partner") })
}

// Keeps a photo, a day or a folder out of memories; the toast has Undo.
export function useHideMemory() {
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  return useCallback(
    async (hide: NewMemoryHide, done: string) => {
      const refresh = () => Promise.all([client.invalidateQueries({ queryKey: [api.id, "memories"] }), client.invalidateQueries({ queryKey: [api.id, "memory-hides"] })])
      try {
        const { id } = await api.post<{ id: string }>("/photos/hides", hide)
        await refresh()
        snack({
          text: done,
          undo: () =>
            api.del(`/photos/hides/${id}`).then(refresh, (e) => snack({ text: errorText(e), error: true })),
        })
      } catch (e) {
        snack({ text: errorText(e), error: true })
      }
    },
    [api, client, snack]
  )
}
