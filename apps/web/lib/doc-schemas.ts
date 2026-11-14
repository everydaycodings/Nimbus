// The Documents input rules, shared by the /api/v1/documents routes and the web's server actions.
// No server-only: pure zod.
import { z } from "zod"

import { isDay } from "./doc-filters.ts"

const uuid = z.string().uuid()
export const day = z.string().refine(isDay, "Use a real date, YYYY-MM-DD.")
// numeric(14,2)
const money = z.number().min(0).max(999_999_999_999)
const lead = z.number().int().min(0).max(3650)
// An empty ?minAmount= means no limit, not 0.
const amount = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).max(999_999_999_999).optional())

export const List = z.object({
  q: z.string().max(200).optional(),
  type: uuid.optional(),
  sender: uuid.optional(),
  status: z.enum(["review", "confirmed", "dismissed"]).optional(),
  from: day.optional(),
  to: day.optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  minAmount: amount,
  maxAmount: amount,
  currency: z.string().length(3).optional(),
  expiring: z.enum(["soon", "expired", "any"]).optional(),
  missing: z.string().max(80).optional(),
  shared: z.enum(["0", "1"]).optional(),
  sort: z.enum(["date", "name", "amount", "expires", "added"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

export const Patch = z.object({
  typeId: uuid.nullable().optional(),
  senderId: uuid.nullable().optional(),
  senderName: z.string().max(100).nullable().optional(),
  docDate: day.nullable().optional(),
  amount: money.nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  expiresAt: day.nullable().optional(),
  remindDays: lead.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  fields: z
    .record(z.string().max(60), z.string().max(500))
    .refine((f) => Object.keys(f).length <= 30, "Too many fields.")
    .optional(),
  status: z.enum(["review", "confirmed", "dismissed"]).optional(),
})

export const Ids = z.array(uuid).min(1).max(500)
export const Bulk = z.object({
  ids: Ids,
  typeId: uuid.nullable().optional(),
  senderId: uuid.nullable().optional(),
  confirm: z.boolean().optional(),
})
export const TypeBody = z.object({ name: z.string().trim().min(1).max(60), remindDays: lead.nullable() })
export const SenderName = z.string().trim().min(1).max(100)
export const Totals = z.object({
  by: z.enum(["sender", "type"]).default("sender"),
  period: z.enum(["month", "year"]).default("month"),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
})
