import { uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { recheck } from "@/lib/secrets/watch"

export const POST = projectRoute<{ wid: string }>("developer", async (c, _r, p) => Response.json(await recheck(c, uuid.parse(p.wid))))
