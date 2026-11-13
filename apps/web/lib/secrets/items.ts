// Typed items: login (with TOTP), API key, database connection, secure note, small file.
// Name, kind and expiry are readable (for the list, search and expiry notices); the
// rest is one sealed JSON blob. A file (1 MB max) rides in that blob as base64, so it's
// in the database, covered by DB backups, and sealed like everything else.
import "server-only"

import { and, asc, eq, ilike } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretItems } from "@/lib/db/schema"
import { SecretsError, seal, unseal, type Ctx } from "./service"
import { parseOtpauth, totp, type TotpOpts } from "./totp"

const bad = (m: string, status = 400) => new SecretsError(status, m)

export const ITEM_KINDS = ["login", "api_key", "db", "note", "file"] as const
export type ItemKind = (typeof ITEM_KINDS)[number]
export const MAX_FILE = 1024 * 1024

export type ItemData = Record<string, string>
// The fields each kind may carry; anything else is dropped.
export const FIELDS: Record<ItemKind, string[]> = {
  login: ["username", "password", "url", "totp", "notes"],
  api_key: ["provider", "token", "scopes", "notes"],
  db: ["engine", "host", "port", "database", "username", "password", "notes"],
  note: ["body"],
  file: ["filename", "mime", "content", "notes"],
}

const clean = (kind: ItemKind, raw: Record<string, unknown>, keep?: ItemData): ItemData => {
  const out: ItemData = {}
  for (const f of FIELDS[kind]) {
    const v = raw[f]
    out[f] = typeof v === "string" ? v : (keep?.[f] ?? "")
    if (out[f].length > (f === "content" ? 1_500_000 : 20_000)) throw bad(`${f} is too long.`)
  }
  if (kind === "login" && out.totp.trim()) {
    try {
      const o = parseOtpauth(out.totp)
      // Keep the whole link when it carried settings, else just the secret.
      out.totp = /^otpauth:/i.test(out.totp.trim()) ? out.totp.trim() : o.secret
    } catch (e) {
      throw bad((e as Error).message)
    }
  }
  if (kind === "file") {
    if (!out.content && !keep) throw bad("Choose a file.")
    if (Buffer.from(out.content, "base64").length > MAX_FILE) throw bad("Files up to 1 MB. Put bigger ones in Files.")
  }
  return out
}

const row = (r: typeof secretItems.$inferSelect) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  updatedAt: r.updatedAt.toISOString(),
})
export type ItemRow = ReturnType<typeof row>

export async function listItems(c: Ctx) {
  const rows = await db
    .select({ id: secretItems.id, kind: secretItems.kind, name: secretItems.name, expiresAt: secretItems.expiresAt, updatedAt: secretItems.updatedAt })
    .from(secretItems)
    .where(eq(secretItems.projectId, c.projectId))
    .orderBy(asc(secretItems.name))
  return rows.map((r) => ({ ...r, expiresAt: r.expiresAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString() }))
}

async function get(c: Ctx, id: string) {
  const [r] = await db.select().from(secretItems).where(and(eq(secretItems.id, id), eq(secretItems.projectId, c.projectId)))
  if (!r) throw bad("That item isn't here.", 404)
  return r
}

const expiry = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null
  const d = new Date(String(v))
  if (isNaN(+d)) throw bad("That expiry date isn't valid.")
  return d
}

export async function createItem(c: Ctx, o: { kind: string; name: string; data: Record<string, unknown>; expiresAt?: string | null }) {
  if (!ITEM_KINDS.includes(o.kind as ItemKind)) throw bad("Pick a type.")
  const kind = o.kind as ItemKind
  const name = o.name.trim().slice(0, 80)
  if (!name) throw bad("Name the item.")
  const data = clean(kind, o.data)
  const [r] = await db
    .insert(secretItems)
    .values({ projectId: c.projectId, kind, name, dataEnc: seal(c, JSON.stringify(data)), expiresAt: kind === "api_key" ? expiry(o.expiresAt) : null, createdBy: c.userId || null })
    .returning()
  await audit("secrets_item_create", { detail: `${name} (${kind})` })
  return row(r)
}

export async function updateItem(c: Ctx, id: string, o: { name?: string; data?: Record<string, unknown>; expiresAt?: string | null }) {
  const r = await get(c, id)
  const kind = r.kind
  const old = JSON.parse(unseal(c, r.dataEnc)) as ItemData
  const name = o.name === undefined ? r.name : o.name.trim().slice(0, 80)
  if (!name) throw bad("Name the item.")
  await db
    .update(secretItems)
    .set({
      name,
      dataEnc: o.data ? seal(c, JSON.stringify(clean(kind, o.data, old))) : r.dataEnc,
      ...(kind === "api_key" && o.expiresAt !== undefined ? { expiresAt: expiry(o.expiresAt), warnedDays: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(secretItems.id, id))
  await audit("secrets_item_edit", { detail: `${name} (${kind})` })
}

export async function deleteItem(c: Ctx, id: string) {
  const r = await get(c, id)
  await db.delete(secretItems).where(eq(secretItems.id, id))
  await audit("secrets_item_delete", { detail: `${r.name} (${r.kind})` })
}

// Opening an item shows its values; that is logged. A file's bytes only come with ?file.
export async function revealItem(c: Ctx, id: string, what: "view" | "copy" = "view") {
  const r = await get(c, id)
  const data = JSON.parse(unseal(c, r.dataEnc)) as ItemData
  await audit(what === "copy" ? "secrets_item_copy" : "secrets_item_reveal", { detail: `${r.name} (${r.kind})` })
  if (r.kind === "file") data.content = "" // bytes via fileOf
  return { ...row(r), data }
}

export async function fileOf(c: Ctx, id: string) {
  const r = await get(c, id)
  if (r.kind !== "file") throw bad("That item isn't a file.", 409)
  const d = JSON.parse(unseal(c, r.dataEnc)) as ItemData
  await audit("secrets_item_download", { detail: `${r.name} (${d.filename})` })
  return { body: Buffer.from(d.content, "base64"), filename: d.filename || r.name, type: d.mime || "application/octet-stream" }
}

// The current code, without showing the TOTP secret. `first` audits one line per time it's shown.
export async function codeOf(c: Ctx, id: string, first: boolean) {
  const r = await get(c, id)
  if (r.kind !== "login") throw bad("That item isn't a login.", 409)
  const d = JSON.parse(unseal(c, r.dataEnc)) as ItemData
  if (!d.totp?.trim()) throw bad("This login has no TOTP secret.", 409)
  const o = parseOtpauth(d.totp)
  if (first) await audit("secrets_item_totp", { detail: r.name })
  return totp(o.secret, Date.now(), o as TotpOpts)
}

// The name search: names only, never what's inside.
export async function itemNames(c: Ctx, q: string) {
  const esc = q.replace(/[\\%_]/g, "\\$&")
  return db
    .select({ id: secretItems.id, name: secretItems.name, kind: secretItems.kind })
    .from(secretItems)
    .where(and(eq(secretItems.projectId, c.projectId), ilike(secretItems.name, `%${esc}%`)))
    .orderBy(asc(secretItems.name))
    .limit(20)
}
