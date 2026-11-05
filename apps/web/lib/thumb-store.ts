// Saves a thumbnail for the route the browser posts to and for the worker
// (scripts/derive.ts), so no `@/` imports. Every version sharing the object
// shares its thumbnail: null = not tried, "" = can't be made, else a revision.
import type { Sql } from "postgres"

import { putObject, thumbKey } from "./s3.ts"

export const setThumb = (sql: Sql, key: string, thumb: string | null) =>
  sql`update file_versions set thumb = ${thumb} where s3_key = ${key}`

// Null saves "can't be made". Resolves the new revision.
export async function saveThumb(
  sql: Sql,
  key: string,
  webp: Uint8Array | null
) {
  if (webp) await putObject(thumbKey(key), webp, "image/webp")
  const thumb = webp ? Date.now().toString(36) : ""
  await setThumb(sql, key, thumb)
  return thumb
}
