import { z } from "zod"

import { fail, json, withMember } from "@/lib/api"
import { db } from "@/lib/db"
import { pushEndpoints } from "@/lib/db/schema"
import { endpointProblem } from "@/lib/push"
import { and, eq } from "drizzle-orm"

const Body = z.object({ endpoint: z.string().max(2000) })

// Registers a UnifiedPush endpoint for this member. Registering the same URL
// again (even from another member) moves it to the caller. Each new
// notification is then POSTed there as {app, id, text}, with no file names.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, Body)
    if (b instanceof Response) return b
    const problem = await endpointProblem(b.endpoint)
    if (problem) return fail(400, "refused", problem)
    await db
      .insert(pushEndpoints)
      .values({ userId: me.id, endpoint: b.endpoint })
      .onConflictDoUpdate({
        target: pushEndpoints.endpoint,
        set: { userId: me.id },
      })
    return Response.json({})
  })

// Forgets an endpoint of mine (after unregistering from the distributor).
export const DELETE = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, Body)
    if (b instanceof Response) return b
    await db
      .delete(pushEndpoints)
      .where(
        and(
          eq(pushEndpoints.userId, me.id),
          eq(pushEndpoints.endpoint, b.endpoint)
        )
      )
    return Response.json({})
  })
