// Transfer (sending files by email or link): hand-offs between its screens, and the list query.
import type { Transfer, TransfersResponse } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"

import { useApi } from "./files"
import type { Entry } from "./upload-plan"

export type Picked = { id: string; name: string; kind: "file" | "folder"; mime?: string | null; size?: number }

// What New transfer starts with: Nimbus items (from a file's ⋯ menu) and phone files (shared in).
let start: { nimbus: Picked[]; device: Entry[] } = { nimbus: [], device: [] }

export function sendWithTransfer(nimbus: Picked[], device: Entry[] = []) {
  start = { nimbus, device }
  router.push("/transfers/new")
}
export function takeStart() {
  const s = start
  start = { nimbus: [], device: [] }
  return s
}

// The Nimbus picker answers through a callback, since a route can't return a value.
let current: Picked[] = []
let answer: ((p: Picked[]) => void) | null = null
export function pickFromNimbus(chosen: Picked[], done: (p: Picked[]) => void) {
  current = chosen
  answer = done
  router.push("/transfers/pick")
}
export const pickerStart = () => current
export const pickerDone = (p: Picked[]) => {
  answer?.(p)
  answer = null
}

export function useSent() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "transfers"], queryFn: () => api.get<TransfersResponse>("/transfers") })
}

export const STATUS = { active: "Active", expired: "Expired", revoked: "Revoked", closed: "Closed" } as const
export const nameOf = (t: Transfer) => t.title || (t.fileCount === 1 ? t.files[0].name : `${t.fileCount} files`)
