import "server-only"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { notifications } from "@/lib/db/schema"
import { listNotifications, type Notification } from "@/lib/notify"
import type { Me } from "@/lib/session"

export async function getNotifications(me: Me): Promise<Notification[]> {
  return listNotifications(me.id)
}

export async function markRead(me: Me, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, me.id),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids.slice(0, 100)) : undefined
      )
    )
}

// Visiting Shared with me clears its badge.
export async function markSharedSeen(me: Me) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, me.id),
        eq(notifications.kind, "shared"),
        isNull(notifications.readAt)
      )
    )
}
