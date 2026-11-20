// Cloud Import connections: a member's saved sources. Each is an rclone remote whose options (token or keys) are sealed with
// lib/crypto. A connection is saved only after `rclone lsd` works on it. Every function takes the member's id.
import "server-only"

import { and, count, desc, eq, sql } from "drizzle-orm"

import { appUrl } from "@/lib/email"
import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { importConnections, importJobs } from "@/lib/db/schema"
import { checkAddress } from "@/lib/secrets/egress"
import { allowPrivate } from "@/lib/secrets/webhooks"
import { getSettings, type Settings } from "@/lib/signup"
import { obscure, withRemote, type Remote } from "./rclone.ts"
import { parseTokenPaste, PROVIDERS, RCLONE_TYPE, rcloneToken, type Provider } from "./rules.ts"

type Row = typeof importConnections.$inferSelect

export type ConnView = {
  id: string
  provider: Provider
  label: string
  account: string | null
  root: string
  lastChecked: string | null
  error: string | null
  jobs: number
}

export const callbackUrl = () => appUrl("/api/import/oauth/callback")

// ---- OAuth apps (Admin → More tools) ----

type App = { id: string; secret: string; auth: string; token: string; scope: string; extra: Record<string, string> }

// The admin's app for a provider, or null when it isn't set up.
export function oauthApp(s: Settings, p: Provider): App | null {
  const pick = (id: string | null, sealed: string | null) => {
    const secret = sealed ? decrypt(sealed) : null
    return id && secret ? { id, secret } : null
  }
  // Google Photos is left out: Google removed photoslibrary.readonly (2025-03-31), so its API no longer lists a library. Takeout covers it.
  if (p === "gdrive") {
    const c = pick(s.importGoogleClientId, s.importGoogleClientSecret)
    return c && { ...c, auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/drive.readonly", extra: { access_type: "offline", prompt: "consent" } }
  }
  if (p === "dropbox") {
    const c = pick(s.importDropboxClientId, s.importDropboxClientSecret)
    return c && { ...c, auth: "https://www.dropbox.com/oauth2/authorize", token: "https://api.dropboxapi.com/oauth2/token", scope: "", extra: { token_access_type: "offline" } }
  }
  if (p === "onedrive") {
    const c = pick(s.importOnedriveClientId, s.importOnedriveClientSecret)
    return c && { ...c, auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scope: "Files.Read Files.Read.All offline_access", extra: {} }
  }
  return null
}

export const oauthReady = (s: Settings) => Object.fromEntries((["gdrive", "gphotos", "dropbox", "onedrive"] as const).map((p) => [p, oauthApp(s, p) !== null])) as Record<"gdrive" | "gphotos" | "dropbox" | "onedrive", boolean>

export function authorizeUrl(app: App, state: string) {
  const u = new URL(app.auth)
  u.search = new URLSearchParams({ client_id: app.id, redirect_uri: callbackUrl(), response_type: "code", state, ...(app.scope && { scope: app.scope }), ...app.extra }).toString()
  return u.toString()
}

// Trades the consent code for tokens, in rclone's token format.
export async function exchangeCode(app: App, code: string) {
  const r = await fetch(app.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, code, grant_type: "authorization_code", redirect_uri: callbackUrl() }),
    signal: AbortSignal.timeout(20_000),
  })
  return rcloneToken((await r.json().catch(() => ({}))) as never)
}

// ---- remotes ----

export function remoteOf(c: Pick<Row, "provider" | "root" | "configEnc">): Remote {
  const sealed = decrypt(c.configEnc)
  if (!sealed) throw new Error("This connection can't be read anymore. Delete it and add it again.")
  return { type: RCLONE_TYPE[c.provider], root: c.root, fields: JSON.parse(sealed) as Record<string, string> }
}

// rclone renews tokens as it works (OneDrive's refresh token changes each time); keep the newest.
export const keepToken = (id: string) => async (fields: Record<string, string>) => {
  await db.update(importConnections).set({ configEnc: encrypt(JSON.stringify(fields)) }).where(eq(importConnections.id, id))
}

// Self-hosted addresses are the member's to type: they must not lead to a private address unless an admin allows that (Admin → Sharing → Secrets).
// ponytail: rclone looks the name up again when it connects, so a name that changes between the check and the run isn't caught.
async function guard(host: string, port: number) {
  await checkAddress(host, port, await allowPrivate()).catch((e: Error) => {
    throw new Error(/private/.test(e.message) ? `${e.message} An admin can allow private addresses in Admin → Sharing → Secrets.` : e.message)
  })
}

export async function guardRemote(r: Remote) {
  const f = r.fields
  if (r.type === "s3" && f.endpoint) {
    const u = new URL(f.endpoint)
    await guard(u.hostname, Number(u.port) || (u.protocol === "https:" ? 443 : 80))
  } else if (r.type === "webdav") {
    const u = new URL(f.url)
    await guard(u.hostname, Number(u.port) || (u.protocol === "https:" ? 443 : 80))
  } else if (r.type === "sftp") await guard(f.host, Number(f.port) || 22)
}

// ---- adding ----

export type NewConnection =
  | { provider: "gdrive" | "gphotos" | "dropbox" | "onedrive"; label?: string; token: string }
  | { provider: "s3"; label?: string; endpoint: string; region?: string; accessKey: string; secretKey: string; bucket?: string }
  | { provider: "webdav"; label?: string; url: string; user?: string; password?: string }
  | { provider: "sftp"; label?: string; host: string; port?: number; user: string; password?: string; privateKey?: string }

const text = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max)

async function freeLabel(userId: string, want: string) {
  const rows = await db.select({ l: sql<string>`lower(${importConnections.label})` }).from(importConnections).where(eq(importConnections.userId, userId))
  const taken = new Set(rows.map((r) => r.l))
  for (let n = 1; ; n++) {
    const l = n === 1 ? want : `${want} (${n})`
    if (!taken.has(l.toLowerCase())) return l
  }
}

// OneDrive needs the drive's id and type in its config; the account's own drive answers both.
async function onedriveDrive(token: string) {
  const r = await fetch("https://graph.microsoft.com/v1.0/me/drive", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null)
  const j = (await r?.json().catch(() => null)) as { id?: string; driveType?: string } | null
  return j?.id ? { drive_id: j.id, drive_type: j.driveType ?? "personal" } : null
}

// Builds the remote's options from what the member typed, or an error to show.
export async function build(v: NewConnection, s: Settings): Promise<{ fields: Record<string, string>; root: string; account: string | null } | { error: string }> {
  if (v.provider === "s3") {
    const endpoint = text(v.endpoint)
    if (!/^https?:\/\/[^/\s]+/.test(endpoint)) return { error: "Enter the endpoint as a full address, like https://s3.example.com." }
    if (!text(v.accessKey) || !text(v.secretKey)) return { error: "Enter the access key and the secret key." }
    return { fields: { provider: "Other", access_key_id: text(v.accessKey), secret_access_key: text(v.secretKey), endpoint, region: text(v.region, 60), force_path_style: "true" }, root: text(v.bucket, 120).replace(/^\/+|\/+$/g, ""), account: new URL(endpoint).host }
  }
  if (v.provider === "webdav") {
    const url = text(v.url)
    if (!/^https?:\/\/[^/\s]+/.test(url)) return { error: "Enter the WebDAV address in full, like https://dav.example.com/files." }
    return { fields: { url, vendor: "other", user: text(v.user, 200), pass: v.password ? await obscure(v.password) : "" }, root: "", account: new URL(url).host }
  }
  if (v.provider === "sftp") {
    const host = text(v.host, 200)
    const port = Math.round(Number(v.port) || 22)
    if (!host || /[\s/]/.test(host) || !text(v.user, 100)) return { error: "Enter the host and the user name." }
    if (!v.password && !v.privateKey?.trim()) return { error: "Enter a password or paste a private key." }
    const key = v.privateKey?.trim()
    if (key && !/^-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----$/.test(key)) return { error: "That doesn't look like a private key. Paste the whole file, from the BEGIN line to the END line." }
    return {
      // Hashes over SSH would run md5sum on the server for every file; sizes and times are enough.
      fields: { host, port: String(port), user: text(v.user, 100), md5sum_command: "none", sha1sum_command: "none", ...(key ? { key_pem: key.replace(/\r?\n/g, "\\n") } : { pass: await obscure(v.password!) }) },
      root: "",
      account: `${text(v.user, 100)}@${host}`,
    }
  }
  if (v.provider === "gphotos") return { error: "Google no longer lets apps read a Google Photos library. Export it with Google Takeout and import the zips instead." }
  // The cloud services: the token pasted from `rclone authorize`, and the admin's app when there is one.
  const tok = parseTokenPaste(v.token)
  if (!tok) return { error: "That doesn't look like the token. Paste everything rclone printed, from the first { to the last }." }
  return cloud(v.provider, tok, s)
}

type Built = { fields: Record<string, string>; root: string; account: string | null }

async function cloud(p: "gdrive" | "gphotos" | "dropbox" | "onedrive", tok: object & { access_token?: string }, s: Settings, viaApp = false): Promise<Built | { error: string }> {
  const app = viaApp ? oauthApp(s, p) : null
  const fields: Record<string, string> = {
    ...(app && { client_id: app.id, client_secret: app.secret }),
    token: JSON.stringify(tok),
    ...(p === "gdrive" && { scope: "drive.readonly" }),
    ...(p === "gphotos" && { read_only: "true" }),
  }
  if (p === "onedrive") {
    const d = await onedriveDrive(tok.access_token ?? "")
    if (!d) return { error: "Couldn't read your OneDrive with that token." }
    Object.assign(fields, d)
  }
  return { fields, root: "", account: null }
}

// The OAuth callback's way in: tokens the admin's app was granted.
export async function addFromOAuth(userId: string, p: "gdrive" | "gphotos" | "dropbox" | "onedrive", tok: object & { access_token?: string }) {
  const b = await cloud(p, tok, await getSettings(), true)
  if ("error" in b) return b
  return save(userId, p, PROVIDERS[p].label, b)
}

async function save(userId: string, provider: Provider, label: string, b: { fields: Record<string, string>; root: string; account: string | null }): Promise<{ id: string } | { error: string }> {
  const remote: Remote = { type: RCLONE_TYPE[provider], root: b.root, fields: b.fields }
  try {
    await guardRemote(remote)
    await withRemote(remote, (r) => r.check())
  } catch (e) {
    return { error: (e as Error).message }
  }
  const [row] = await db
    .insert(importConnections)
    .values({ userId, provider, label: await freeLabel(userId, label), account: b.account, root: b.root, configEnc: encrypt(JSON.stringify(b.fields)), lastChecked: new Date() })
    .returning({ id: importConnections.id })
  return { id: row.id }
}

export async function createConnection(userId: string, v: NewConnection): Promise<{ id: string } | { error: string }> {
  if (!(v.provider in PROVIDERS)) return { error: "Pick a service." }
  const b = await build(v, await getSettings()).catch((e: Error) => ({ error: e.message }))
  if (!("fields" in b)) return { error: b.error ?? "Couldn't connect." }
  return save(userId, v.provider, text(v.label, 60) || PROVIDERS[v.provider].label, b)
}

// ---- managing ----

export async function listConnections(userId: string): Promise<ConnView[]> {
  const rows = await db
    .select({ c: importConnections, jobs: sql<number>`(select count(*) from ${importJobs} j where j.connection_id = ${importConnections.id})`.mapWith(Number) })
    .from(importConnections)
    .where(eq(importConnections.userId, userId))
    .orderBy(desc(importConnections.createdAt))
  return rows.map(({ c, jobs }) => ({ id: c.id, provider: c.provider, label: c.label, account: c.account, root: c.root, lastChecked: c.lastChecked?.toISOString() ?? null, error: c.error, jobs }))
}

export async function ownConnection(userId: string, id: string) {
  const [c] = await db.select().from(importConnections).where(and(eq(importConnections.id, id), eq(importConnections.userId, userId)))
  return c ?? null
}

export async function checkConnection(userId: string, id: string): Promise<{ error?: string }> {
  const c = await ownConnection(userId, id)
  if (!c) return { error: "That connection is gone." }
  let error: string | null = null
  try {
    const r = remoteOf(c)
    await guardRemote(r)
    await withRemote(r, (s) => s.check(), keepToken(c.id))
  } catch (e) {
    error = (e as Error).message
  }
  await db.update(importConnections).set({ lastChecked: new Date(), error }).where(eq(importConnections.id, id))
  return error ? { error } : {}
}

export async function renameConnection(userId: string, id: string, label: string): Promise<{ error?: string }> {
  const l = text(label, 60)
  if (!l) return { error: "Give it a name." }
  try {
    await db.update(importConnections).set({ label: l }).where(and(eq(importConnections.id, id), eq(importConnections.userId, userId)))
  } catch {
    return { error: "You already have a connection with that name." }
  }
  return {}
}

export async function deleteConnection(userId: string, id: string): Promise<{ error?: string }> {
  const [{ n }] = await db.select({ n: count() }).from(importJobs).where(and(eq(importJobs.connectionId, id), eq(importJobs.userId, userId)))
  if (n) return { error: `${n === 1 ? "An import uses" : `${n} imports use`} this connection. Delete ${n === 1 ? "it" : "them"} first.` }
  await db.delete(importConnections).where(and(eq(importConnections.id, id), eq(importConnections.userId, userId)))
  return {}
}
