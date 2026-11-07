// Sending an edited text file up: as a new version of the file, or as a renamed copy. Used by the editor and by the offline queue.
import type { Instance, ItemResponse, Me } from "@nimbus/shared/api"
import { File, Paths } from "expo-file-system"

import { ApiError, json, type Account } from "./api"
import type { NativeJob } from "./native"
import { engine, plan } from "./uploads"

export const CHANGED = "This file changed on the server since you opened it."

export const currentOf = (a: Account, id: string) => json<ItemResponse>(a.server, `/api/v1/items/${id}`, { token: a.token })

// Queues the upload; the previewer and lists refresh when it finishes (components/uploader.tsx).
export async function uploadText(a: Account, parentId: string | null, name: string, text: string, as: "version" | "copy") {
  const file = new File(Paths.cache, `edit-${Date.now()}-${name.replace(/[^\w.-]/g, "_")}`)
  file.create({ overwrite: true })
  await file.write(text)
  const size = file.size ?? new TextEncoder().encode(text).length
  const answer = await plan(a, parentId, [{ path: name, size, uri: file.uri }])
  if (answer.error || !answer.token) throw new ApiError(400, "plan", answer.error ?? "Couldn't start the upload. Try again.")
  if (answer.rejected.length) throw new ApiError(400, "rejected", answer.rejected[0].reason)
  const auth = { token: a.token }
  const [instance, me] = await Promise.all([json<Instance>(a.server, "/api/v1/instance"), json<Me>(a.server, "/api/v1/me", auth)])
  const job: NativeJob = {
    accountId: a.id,
    server: a.server,
    tusUrl: instance.tusUrl,
    uri: file.uri,
    name,
    size,
    mime: "text/plain",
    path: name,
    planToken: answer.token,
    parentId,
    onConflict: as === "version" ? "version" : "rename",
    wifiOnly: false,
    speedCap: me.uploadSpeedBytes ?? null,
  }
  await engine.add([job], a.token)
}
