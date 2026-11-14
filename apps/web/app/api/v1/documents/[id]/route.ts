import { z } from "zod"

import { done, json, notFound, uuid } from "@/lib/api"
import * as svc from "@/lib/services/documents"

type Ctx = { params: Promise<{ id: string }> }

export const GET = (_: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    const d = uuid.safeParse(id).success ? await svc.getDocument(me, id) : null
    return d ? Response.json(d) : notFound("That document")
  })

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine((d) => { const t = Date.parse(d + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d }, "Not a real date.").nullable()
const Patch = z.object({
  typeId: uuid.nullable().optional(),
  senderId: uuid.nullable().optional(),
  senderName: z.string().max(100).nullable().optional(),
  docDate: day.optional(),
  amount: z.number().min(0).max(1e12).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  expiresAt: day.optional(),
  remindDays: z.number().int().min(0).max(3650).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  fields: z.record(z.string().max(60), z.string().max(500)).refine((f) => Object.keys(f).length <= 30, "Too many fields.").optional(),
  status: z.enum(["review", "confirmed", "dismissed"]).optional(),
})

// Edit fields, confirm (status "confirmed"), "Not a document" (status "dismissed") or undo (status "review"). Owner only.
export const PATCH = (req: Request, { params }: Ctx) =>
  svc.withDocs(async (me) => {
    const { id } = await params
    if (!uuid.safeParse(id).success) return notFound("That document")
    const b = await json(req, Patch)
    if (b instanceof Response) return b
    return done(await svc.updateDocument(me, id, b))
  })
