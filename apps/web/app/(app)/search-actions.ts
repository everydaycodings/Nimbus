"use server"

import { type Hit } from "@/lib/files"
import * as svc from "@/lib/services/search"
import { requireMember } from "@/lib/session"

// The search box's dropdown.
export async function quickSearch(q: string): Promise<Hit[]> {
  return svc.quickSearch(await requireMember(), q)
}
