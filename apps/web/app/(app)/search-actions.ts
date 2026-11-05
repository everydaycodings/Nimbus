"use server"

import { type Source } from "@/lib/extract"
import { type Hit } from "@/lib/files"
import * as svc from "@/lib/services/search"
import { requireMember } from "@/lib/session"

// The search box's dropdown.
export async function quickSearch(q: string): Promise<Hit[]> {
  return svc.quickSearch(await requireMember(), q)
}

// Text the browser read from a file's current version. Anyone who can edit the
// file may index it; a stale version is ignored.
export async function saveContent(
  id: string,
  versionId: string,
  body: string,
  source: Source
) {
  return svc.saveContent(await requireMember(), id, versionId, body, source)
}

export async function ocrLangs() {
  await requireMember()
  return svc.ocrLangs()
}
