// Face grouping (Phase 20): who is in my photos. Everything here needs the admin's switch and my own.
import type { AiFlags, FileFacesResponse, PeopleResponse, PersonResponse, PersonFacesResponse, PersonSuggestionsResponse, TranscriptResponse } from "@nimbus/shared/api"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { useApi, useMe } from "./files"
import { useAllPages } from "./photos"

const NONE: AiFlags = { speech: false, picture: false, faces: false, facesOn: false }

// Older servers and signed-out moments give no flags: every AI screen stays hidden.
export function useAi(): AiFlags {
  return useMe().data?.ai ?? NONE
}

// People I can see: named first, then by photos. `hidden` lists the ones I put away.
export function usePeople(hidden: boolean, enabled = true) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "people-list", hidden],
    staleTime: 30_000,
    queryFn: () => api.get<PeopleResponse>(`/people${hidden ? "?hidden=1" : ""}`),
  })
}

// One person's photos, all pages; `person` is on the first.
export function usePerson(id: string) {
  const q = useAllPages(["people", id], `/people/${id}`)
  return { ...q, person: (q.data?.pages[0] as PersonResponse | undefined)?.person }
}

// Their faces, clearest first, to pick a picture from.
export function usePersonFaces(id: string, enabled: boolean) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "people-faces", id],
    queryFn: () => api.get<PersonFacesResponse>(`/people/${id}/faces`).then((r) => r.faces),
  })
}

export function useSuggestions(id: string, enabled: boolean) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "people-suggest", id],
    queryFn: () => api.get<PersonSuggestionsResponse>(`/people/${id}/suggestions`).then((r) => r.suggestions),
  })
}

export function useFileFaces(id: string, enabled: boolean) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "faces", id],
    queryFn: () => api.get<FileFacesResponse>(`/files/${id}/faces`).then((r) => r.faces),
  })
}

export function useTranscript(id: string, enabled: boolean) {
  const api = useApi()
  return useQuery({
    enabled,
    queryKey: [api.id, "transcript", id],
    queryFn: () => api.get<TranscriptResponse>(`/files/${id}/transcript`),
  })
}

// After a rename, merge, move or answer: every list that shows people or their photos.
export function usePeopleRefresh() {
  const api = useApi()
  const client = useQueryClient()
  return useCallback(
    () =>
      Promise.all(["people", "people-list", "people-suggest", "people-faces", "faces", "memories", "photos"].map((k) => client.invalidateQueries({ queryKey: [api.id, k] }))),
    [api.id, client]
  )
}

const image = (account: { server: string; token: string }, path: string) => ({
  uri: `${account.server}/api/v1${path}`,
  headers: { authorization: `Bearer ${account.token}` },
})
// `v` makes the picture reload when the person's face changes (a merge, a new cover).
export const coverSource = (account: { server: string; token: string }, personId: string, faceId: string | null) => image(account, `/people/${personId}/cover?v=${faceId ?? ""}`)
export const cropSource = (account: { server: string; token: string }, faceId: string) => image(account, `/faces/${faceId}/crop`)

export const photosText = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`
