"use server"

import * as svc from "@/lib/services/notifications"
import { type Notification } from "@/lib/notify"
import { requireMember } from "@/lib/session"

export async function getNotifications(): Promise<Notification[]> {
  return svc.getNotifications(await requireMember())
}

export async function markRead(ids?: string[]) {
  await svc.markRead(await requireMember(), ids)
}

// Visiting Shared with me clears its badge.
export async function markSharedSeen() {
  await svc.markSharedSeen(await requireMember())
}
