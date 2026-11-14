import { headers } from "next/headers"
import { z } from "zod"

import { overLimit } from "@/lib/cache"
import { TYPE_KEYS, UUID, typeKeyOf } from "@/lib/file-rules"
import { listTags, type Item } from "@/lib/files"
import { gateOf, getSession, type Me } from "@/lib/session"
import { NOT_ALLOWED } from "@/lib/tree-ops"
import { ipFrom } from "@/lib/client-ip"

// Bumped when a change would break older Android apps. The app refuses servers
// outside the range it knows and says which side needs updating.
export const API_VERSION = 2

export const fail = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status })

// Per-minute limits, tunable from env; a bad or missing value falls back to the default.
const limitFromEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}
const USER_LIMIT = limitFromEnv("API_RATE_LIMIT_USER", 1200)
const INSTANCE_IP_LIMIT = limitFromEnv("API_RATE_LIMIT_INSTANCE_IP", 120)

// Guard for /api/v1 routes: the JSON twin of requireMember(). 403 means a gate
// stands in the way, and GET /api/v1/me says which.
export async function withMember(fn: (me: Me) => Promise<Response>) {
  const session = await getSession()
  if (!session) return fail(401, "signed-out", "Sign in first.")
  const me = session.user
  // Every gate, not just requireMember()'s: the app only learns about a new one
  // (say, admins now require two-factor) when a request is refused.
  if (await gateOf(me))
    return fail(403, "gated", "Finish setting up your account first.")
  if (await overLimit(`rl:u:${me.id}`, USER_LIMIT, 60)) return rateLimited()
  return fn(me)
}

const rateLimited = () =>
  fail(429, "rate_limited", "Too many requests. Try again in a minute.")

// Per-IP limit for public routes (API_RATE_LIMIT_INSTANCE_IP, 120 a minute), or a 429 Response.
export async function limitIp(name: string) {
  const h = await headers()
  const ip =
    ipFrom(h) || "?"
  return (await overLimit(`rl:ip:${name}:${ip}`, INSTANCE_IP_LIMIT, 60)) ? rateLimited() : null
}

// ---- Input ----



export const uuid = z.string().regex(UUID, "Not a valid id.")

function check<S extends z.ZodType>(schema: S, raw: unknown) {
  const r = schema.safeParse(raw)
  if (r.success) return r.data as z.infer<S>
  const i = r.error.issues[0]
  const where = i.path.length ? ` (${i.path.join(".")})` : ""
  return fail(400, "bad-request", `${i.message}${where}`)
}

// The JSON body, or a 400 Response. Callers: `if (b instanceof Response) return b`.
export async function json<S extends z.ZodType>(req: Request, schema: S) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return fail(400, "bad-request", "Send a JSON body.")
  }
  return check(schema, raw)
}

// The query string, same contract as json().
export function query<S extends z.ZodType>(req: Request, schema: S) {
  return check(schema, Object.fromEntries(new URL(req.url).searchParams))
}

// A service's { error } becomes a 4xx; anything else is the 200 body.
export function done<T extends { error?: string }>(r: T) {
  if (!r.error) return Response.json(r)
  if (r.error === NOT_ALLOWED || /^(You can't|Only the owner)/.test(r.error))
    return fail(403, "forbidden", r.error)
  if (/\b(gone|withdrawn)\b|isn't available/.test(r.error))
    return fail(404, "not-found", r.error)
  return fail(400, "refused", r.error)
}

export const notFound = (what = "That") =>
  fail(404, "not-found", `${what} isn't here, or you can't open it.`)

// ---- Lists ----

const MB = 1024 ** 2
const SIZES = {
  small: [0, MB],
  medium: [MB, 100 * MB],
  large: [100 * MB, 1024 * MB],
  huge: [1024 * MB, Infinity],
} as const
const DAY = 24 * 60 * 60 * 1000
const SINCE = {
  today: () => new Date().setHours(0, 0, 0, 0),
  week: () => Date.now() - 7 * DAY,
  month: () => Date.now() - 30 * DAY,
  year: () => new Date(new Date().getFullYear(), 0, 1).getTime(),
}

// The filters and sort the web's file lists have, plus paging.
export const listQuery = z.object({
  type: z.enum(TYPE_KEYS).optional(),
  modified: z.enum(["today", "week", "month", "year"]).optional(),
  size: z.enum(["small", "medium", "large", "huge"]).optional(),
  tag: uuid.optional(),
  sort: z.enum(["rank", "name", "date", "size"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.coerce.number().int().min(0).default(0),
})

// Filters, sorts and pages a list the way the web does it in the browser.
// ponytail: the queries return whole lists, so paging slices them in memory
// (cursor is an offset); push LIMIT into the queries if folders reach 100k items.
export async function listResponse<T extends Item>(
  me: Me,
  req: Request,
  items: T[],
  o: { sort?: "rank" | "name" | "date"; trash?: boolean } = {},
  extra: object = {}
) {
  const q = query(req, listQuery)
  if (q instanceof Response) return q
  const sort = q.sort ?? o.sort ?? "name"
  const desc = q.order ? q.order === "desc" : sort !== "name"
  const dateOf = (i: Item) => (o.trash ? i.trashedAt! : i.updatedAt)
  const since = q.modified ? SINCE[q.modified]() : null
  const [min, max] = q.size ? SIZES[q.size] : [0, Infinity]
  const shown = items
    .filter(
      (i) =>
        (!q.type || typeKeyOf(i.kind, i.mime, i.name) === q.type) &&
        (since === null || Date.parse(dateOf(i)) >= since) &&
        (!q.size || (i.size >= min && i.size < max)) &&
        (!q.tag || i.tags.includes(q.tag))
    )
    .sort((a, b) => {
      if (sort === "rank") return 0
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      const d =
        sort === "name"
          ? a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          : sort === "size"
            ? a.size - b.size
            : Date.parse(dateOf(a)) - Date.parse(dateOf(b))
      return desc ? -d : d
    })
  const next = q.cursor + q.limit
  return Response.json({
    items: shown.slice(q.cursor, next),
    total: shown.length,
    nextCursor: next < shown.length ? String(next) : null,
    tags: await listTags(me.id),
    ...extra,
  })
}
