import { z } from "zod"

import { json, query, uuid } from "@/lib/api"
import { addComment, deleteComment, listComments } from "@/lib/secrets/comments"
import { projectRoute } from "@/lib/secrets/guard"

const on = z.object({ secretId: uuid.optional(), requestId: uuid.optional() })

export const GET = projectRoute("viewer", async (c, req) => {
  const q = query(req, on)
  if (q instanceof Response) return q
  return Response.json({ comments: await listComments(c, q) })
})

export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(req, on.extend({ body: z.string().max(2000) }))
  if (b instanceof Response) return b
  await addComment(c, b, b.body)
  return Response.json({ comments: await listComments(c, b) })
})

export const DELETE = projectRoute("viewer", async (c, req) => {
  const q = query(req, z.object({ id: uuid }))
  if (q instanceof Response) return q
  await deleteComment(c, q.id)
  return Response.json({ ok: true })
})
