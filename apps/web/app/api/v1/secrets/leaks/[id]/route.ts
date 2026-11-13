import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { withSecrets } from "@/lib/secrets/guard"
import { moveLeak, resolveLeak } from "@/lib/secrets/leaks"

type Ctx = { params: Promise<{ id: string }> }

// dismiss | false_positive | reopen, or move to a project (optionally redacting the file).
export const POST = (req: Request, { params }: Ctx) =>
  withSecrets(async (me) => {
    const id = uuid.parse((await params).id)
    const b = await json(
      req,
      z.discriminatedUnion("action", [
        z.object({ action: z.enum(["dismiss", "false_positive", "reopen"]) }),
        z.object({ action: z.literal("move"), projectId: uuid, envId: uuid, key: z.string().max(200), redact: z.boolean().default(false) }),
      ])
    )
    if (b instanceof Response) return b
    if (b.action === "move") return Response.json(await moveLeak(me.id, id, b))
    await resolveLeak(me.id, id, b.action)
    return Response.json({})
  })
