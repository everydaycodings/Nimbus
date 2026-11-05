import { and, eq, isNull, sql } from "drizzle-orm"

import { withMember } from "@/lib/api"
import { db } from "@/lib/db"
import { notifications } from "@/lib/db/schema"
import * as svc from "@/lib/services/notifications"

// The bell: notifications as sentences, newest first, with the unread counts
// the badges use (`shared` is how many of them are new shares).
export const GET = () =>
  withMember(async (me) => {
    const [items, [counts]] = await Promise.all([
      svc.getNotifications(me),
      db
        .select({
          unread: sql<number>`count(*)::int`,
          shared: sql<number>`(count(*) filter (where ${notifications.kind} = 'shared'))::int`,
        })
        .from(notifications)
        .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt))),
    ])
    return Response.json({ items, ...counts })
  })
