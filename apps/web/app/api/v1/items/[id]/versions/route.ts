import { done, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

type Ctx = { params: Promise<{ id: string }> }

// Owners and editors only; anyone else gets an empty list.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) =>
    Response.json({ versions: await svc.listVersions(me, (await params).id) })
  )

// Deletes every older version except ones marked keep. Answers { count }.
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) =>
    done(await svc.deleteOlderVersions(me, (await params).id))
  )
