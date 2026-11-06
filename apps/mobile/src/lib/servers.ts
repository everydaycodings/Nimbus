// What each signed-in server last said about itself. Not saved: it's re-asked at launch and on return to the app.
import type { Instance } from "@nimbus/shared/api"
import { useSyncExternalStore } from "react"

import { json } from "./api"
import { versionProblem, type VersionProblem } from "./api-version"

export type ServerInfo = { instance: Instance; problem: VersionProblem | null }

const known = new Map<string, ServerInfo>()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const serverInfo = (accountId: string) => known.get(accountId)
export const useServerInfo = (accountId: string | undefined) =>
  useSyncExternalStore(subscribe, () => (accountId ? known.get(accountId) : undefined))

// An unreachable server keeps whatever it said before: being offline isn't a version problem.
export async function checkServers(accounts: { id: string; server: string }[]) {
  await Promise.all(
    accounts.map(async (a) => {
      try {
        const instance = await json<Instance>(a.server, "/api/v1/instance")
        if (instance?.app !== "nimbus") return
        known.set(a.id, { instance, problem: versionProblem(instance.apiVersion) })
        listeners.forEach((fn) => fn())
      } catch {}
    })
  )
}
