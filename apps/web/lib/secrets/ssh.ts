// S4 SSH: stored keys, host entries, the project's SSH CA and terminal tickets.
// Roles: a Viewer (or a member limited to some environments) can look but not touch a
// private key; a Developer creates and reveals keys, issues certificates and opens the
// terminal; an Admin also deletes keys and sets up or rotates the CA.
import "server-only"

import { randomBytes } from "node:crypto"

import { and, asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/lib/db"
import { secretSshCas, secretSshCerts, secretSshHosts, secretSshKeys, user } from "@/lib/db/schema"
import { redis } from "@/lib/redis"
import { openServer, openValue, sealServer, sealValue } from "./kms"
import { SecretsError, type Ctx } from "./service"
import {
  CERT_MAX_HOURS,
  CERT_MIN_HOURS,
  SshError,
  alias,
  generateCa,
  generateKey,
  inspectPrivate,
  parsePublic,
  signUserCert,
  sshConfig,
  sshdScript,
  type HostRow,
} from "./ssh-rules"

const bad = (m: string, status = 400) => new SecretsError(status, m)

// Turns a rules error into a 400.
async function rules<T>(f: () => T | Promise<T>) {
  try {
    return await f()
  } catch (e) {
    if (e instanceof SshError) throw bad(e.message)
    throw e
  }
}

export const canUse = (c: Ctx) => c.role !== "viewer" && !c.envs
export function mustUse(c: Ctx) {
  if (!canUse(c)) throw bad("Your access to this project can't use SSH keys.", 403)
}
const mustAdmin = (c: Ctx) => {
  if (c.role !== "admin") throw bad("Only a project admin can do that.", 403)
}

// ---------- keys ----------

export async function listKeys(c: Ctx) {
  const rows = await db.select().from(secretSshKeys).where(eq(secretSshKeys.projectId, c.projectId)).orderBy(asc(secretSshKeys.name))
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    kind: k.kind,
    publicKey: k.publicKey,
    fingerprint: k.fingerprint,
    comment: k.comment,
    hasPassphrase: Boolean(k.passphraseEnc),
    createdAt: k.createdAt.toISOString(),
  }))
}

export type KeyInput =
  | { mode: "generate"; name: string; kind: "ed25519" | "rsa"; comment?: string; passphrase?: string }
  | { mode: "import"; name: string; privateKey: string; passphrase?: string; comment?: string }

const keyName = (n: string) => {
  const v = n.trim()
  if (!v || v.length > 60) throw bad("Give the key a name (up to 60 characters).")
  return v
}

export async function createKey(c: Ctx, i: KeyInput) {
  mustUse(c)
  const name = keyName(i.name)
  const pass = i.passphrase || undefined
  const k =
    i.mode === "generate"
      ? await rules(() => generateKey(i.kind, i.comment?.trim() || `${name}@nimbus`, pass))
      : await rules(() => {
          const info = inspectPrivate(i.privateKey, pass)
          return { ...info, privateKey: i.privateKey.trim() + "\n", comment: i.comment?.trim() || info.comment }
        })
  const [row] = await db
    .insert(secretSshKeys)
    .values({
      projectId: c.projectId,
      name,
      kind: k.kind,
      publicKey: k.publicKey,
      fingerprint: k.fingerprint,
      comment: k.comment || null,
      privateEnc: sealValue(c.key, c.projectId, k.privateKey),
      passphraseEnc: pass ? sealValue(c.key, c.projectId, pass) : null,
      createdBy: c.userId || null,
    })
    .returning({ id: secretSshKeys.id })
  return { id: row.id, name, kind: k.kind, fingerprint: k.fingerprint }
}

async function getKey(c: Ctx, id: string) {
  const [k] = await db
    .select()
    .from(secretSshKeys)
    .where(and(eq(secretSshKeys.id, id), eq(secretSshKeys.projectId, c.projectId)))
  if (!k) throw bad("That key isn't here.", 404)
  return k
}

// Private key text and passphrase, opened. Callers audit the reveal.
export async function openKey(c: Ctx, id: string) {
  const k = await getKey(c, id)
  return {
    name: k.name,
    fingerprint: k.fingerprint,
    privateKey: openValue(c.key, c.projectId, k.privateEnc),
    passphrase: k.passphraseEnc ? openValue(c.key, c.projectId, k.passphraseEnc) : null,
  }
}

export async function revealKey(c: Ctx, id: string) {
  mustUse(c)
  return openKey(c, id)
}

export async function renameKey(c: Ctx, id: string, name: string) {
  mustUse(c)
  const k = await getKey(c, id)
  await db.update(secretSshKeys).set({ name: keyName(name) }).where(eq(secretSshKeys.id, id))
  return k.name
}

export async function deleteKey(c: Ctx, id: string) {
  mustAdmin(c)
  const k = await getKey(c, id)
  await db.delete(secretSshKeys).where(eq(secretSshKeys.id, id))
  return k.name
}

// ---------- hosts ----------

export type HostInput = {
  name: string
  host: string
  port: number
  username: string
  keyId?: string | null
  useCa?: boolean
  jumpHostId?: string | null
  forgetHostKey?: boolean
}

// Request body for creating or editing a host.
export const hostBody = z.object({
  name: z.string(),
  host: z.string().max(200),
  port: z.number().int().default(22),
  username: z.string().max(60),
  keyId: z.string().uuid().nullish(),
  useCa: z.boolean().optional(),
  jumpHostId: z.string().uuid().nullish(),
  forgetHostKey: z.boolean().optional(),
})

export async function listHosts(c: Ctx) {
  const rows = await db.select().from(secretSshHosts).where(eq(secretSshHosts.projectId, c.projectId)).orderBy(asc(secretSshHosts.name))
  return rows.map((h) => ({
    id: h.id,
    name: h.name,
    host: h.host,
    port: h.port,
    username: h.username,
    keyId: h.keyId,
    useCa: h.useCa,
    jumpHostId: h.jumpHostId,
    pinned: Boolean(h.hostKey),
  }))
}

export async function saveHost(c: Ctx, i: HostInput, id?: string) {
  mustUse(c)
  const name = i.name.trim()
  const host = i.host.trim()
  if (!name || name.length > 60) throw bad("Give the host a name (up to 60 characters).")
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) throw bad("Enter a host name or IP address.")
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(i.username.trim())) throw bad("Enter the SSH user name.")
  if (!(i.port >= 1 && i.port <= 65535)) throw bad("The port is 1 to 65535.")
  const useCa = Boolean(i.useCa)
  if (!useCa && !i.keyId) throw bad("Pick a stored key, or sign in with the CA.")
  if (i.keyId) await getKey(c, i.keyId)
  if (useCa && !(await getCa(c))) throw bad("Set up the SSH CA first.")
  if (i.jumpHostId) {
    if (i.jumpHostId === id) throw bad("A host can't be its own jump host.")
    const [j] = await db
      .select()
      .from(secretSshHosts)
      .where(and(eq(secretSshHosts.id, i.jumpHostId), eq(secretSshHosts.projectId, c.projectId)))
    if (!j) throw bad("That jump host isn't here.", 404)
    if (j.jumpHostId) throw bad("Jump hosts can't chain (one hop only).")
  }
  const [old] = id
    ? await db
        .select()
        .from(secretSshHosts)
        .where(and(eq(secretSshHosts.id, id), eq(secretSshHosts.projectId, c.projectId)))
    : []
  if (id && !old) throw bad("That host isn't here.", 404)
  const moved = old && (old.host !== host || old.port !== i.port)
  const v = {
    name,
    host,
    port: i.port,
    username: i.username.trim(),
    keyId: i.keyId || null,
    useCa,
    jumpHostId: i.jumpHostId || null,
    hostKey: moved || i.forgetHostKey ? null : (old?.hostKey ?? null),
  }
  if (id) {
    await db.update(secretSshHosts).set(v).where(eq(secretSshHosts.id, id))
    return id
  }
  const [row] = await db.insert(secretSshHosts).values({ projectId: c.projectId, ...v }).returning({ id: secretSshHosts.id })
  return row.id
}

export async function deleteHost(c: Ctx, id: string) {
  mustUse(c)
  const [h] = await db
    .delete(secretSshHosts)
    .where(and(eq(secretSshHosts.id, id), eq(secretSshHosts.projectId, c.projectId)))
    .returning({ name: secretSshHosts.name })
  if (!h) throw bad("That host isn't here.", 404)
  return h.name
}

// ~/.ssh/config text for one host (with its jump host) or all of them.
export async function exportConfig(c: Ctx, hostId?: string) {
  const hosts = await db.select().from(secretSshHosts).where(eq(secretSshHosts.projectId, c.projectId)).orderBy(asc(secretSshHosts.name))
  const keys = new Map((await listKeys(c)).map((k) => [k.id, k]))
  const byId = new Map(hosts.map((h) => [h.id, h]))
  let pick = hosts
  if (hostId) {
    const h = byId.get(hostId)
    if (!h) throw bad("That host isn't here.", 404)
    pick = [h, ...(h.jumpHostId && byId.get(h.jumpHostId) ? [byId.get(h.jumpHostId)!] : [])]
  }
  const file = (id: string | null) => (id && keys.get(id) ? "nimbus_" + alias(keys.get(id)!.name) : null)
  const rows: HostRow[] = pick.map((h) => ({
    name: h.name,
    host: h.host,
    port: h.port,
    username: h.username,
    keyFile: h.useCa ? "nimbus_" + alias(h.name) : file(h.keyId),
    cert: h.useCa,
    jump: h.jumpHostId ? (byId.get(h.jumpHostId)?.name ?? null) : null,
  }))
  const note = "# Nimbus Secrets. Save each private key from the SSH tab as ~/.ssh/<file> (chmod 600).\n"
  return note + sshConfig(rows)
}

// ---------- CA ----------

export async function getCa(c: Ctx) {
  const [ca] = await db.select().from(secretSshCas).where(eq(secretSshCas.projectId, c.projectId))
  return ca ?? null
}

export async function caView(c: Ctx) {
  const ca = await getCa(c)
  if (!ca) return { ca: null, certs: [] }
  const certs = await db
    .select({
      id: secretSshCerts.id,
      serial: secretSshCerts.serial,
      keyId: secretSshCerts.keyId,
      principals: secretSshCerts.principals,
      fingerprint: secretSshCerts.publicFingerprint,
      expiresAt: secretSshCerts.expiresAt,
      createdAt: secretSshCerts.createdAt,
      by: user.name,
      current: sql<boolean>`${secretSshCerts.caFingerprint} = ${ca.fingerprint}`,
    })
    .from(secretSshCerts)
    .leftJoin(user, eq(user.id, secretSshCerts.issuedBy))
    .where(eq(secretSshCerts.projectId, c.projectId))
    .orderBy(desc(secretSshCerts.createdAt))
    .limit(100)
  return {
    ca: {
      publicKey: ca.publicKey,
      fingerprint: ca.fingerprint,
      createdAt: ca.createdAt.toISOString(),
      rotatedAt: ca.rotatedAt?.toISOString() ?? null,
      script: sshdScript(ca.publicKey),
    },
    certs: certs.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString() })),
  }
}

// Creates the CA, or (rotate) replaces its key: certificates from the old one stop
// working once servers trust the new public key.
export async function setupCa(c: Ctx, rotate: boolean) {
  mustAdmin(c)
  const old = await getCa(c)
  if (old && !rotate) throw bad("This project already has an SSH CA.", 409)
  if (!old && rotate) throw bad("Set up the CA first.", 404)
  const n = generateCa(`nimbus-ca-${c.projectId.slice(0, 8)}`)
  const v = { publicKey: n.publicKey, fingerprint: n.fingerprint, privateEnc: sealValue(c.key, c.projectId, n.privatePem) }
  if (old) await db.update(secretSshCas).set({ ...v, rotatedAt: new Date() }).where(eq(secretSshCas.projectId, c.projectId))
  else await db.insert(secretSshCas).values({ projectId: c.projectId, ...v })
  return n.fingerprint
}

export type IssueInput = { principals: string[]; hours: number; publicKey?: string }

// Signs a pasted public key, or generates a fresh ed25519 pair (returned once) when none is given.
export async function issueCert(c: Ctx, userId: string, i: IssueInput) {
  mustUse(c)
  const ca = await getCa(c)
  if (!ca) throw bad("Set up the SSH CA first.", 404)
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  const keyId = u?.email ?? "nimbus"
  const gen = i.publicKey?.trim() ? null : await rules(() => generateKey("ed25519", keyId))
  const subject = i.publicKey?.trim() || gen!.publicKey
  const [bump] = await db
    .update(secretSshCas)
    .set({ nextSerial: sql`${secretSshCas.nextSerial} + 1` })
    .where(eq(secretSshCas.projectId, c.projectId))
    .returning({ s: secretSshCas.nextSerial })
  const serial = bump.s - 1
  const cert = await rules(() =>
    signUserCert({
      caPrivatePem: openValue(c.key, c.projectId, ca.privateEnc),
      caPublicKey: ca.publicKey,
      subjectPublicKey: subject,
      keyId,
      principals: i.principals,
      serial,
      hours: i.hours,
    })
  )
  await db.insert(secretSshCerts).values({
    projectId: c.projectId,
    serial,
    keyId,
    principals: i.principals.join(","),
    publicFingerprint: parsePublic(subject).fingerprint,
    caFingerprint: ca.fingerprint,
    issuedBy: userId || null,
    expiresAt: cert.expiresAt,
  })
  return {
    certificate: cert.line,
    expiresAt: cert.expiresAt.toISOString(),
    serial,
    principals: i.principals,
    keyId,
    privateKey: gen?.privateKey ?? null,
    publicKey: subject,
  }
}

export const HOURS = { min: CERT_MIN_HOURS, max: CERT_MAX_HOURS }

// ---------- terminal ----------

export type Hop = {
  host: string
  port: number
  username: string
  hostId: string
  hostKey: string | null
  privateKey: string
  passphrase?: string
  certificate?: string
}
export type Ticket = { userId: string; projectId: string; label: string; target: Hop; jump?: Hop }

async function hop(c: Ctx, userId: string, h: typeof secretSshHosts.$inferSelect): Promise<Hop> {
  const base = { host: h.host, port: h.port, username: h.username, hostId: h.id, hostKey: h.hostKey }
  if (h.useCa) {
    // A throwaway key and a one-hour certificate for the user name on this host.
    const k = generateKey("ed25519", "nimbus-terminal")
    const cert = await issueCert(c, userId, { principals: [h.username], hours: 1, publicKey: k.publicKey })
    return { ...base, privateKey: k.privateKey, certificate: cert.certificate }
  }
  if (!h.keyId) throw bad("This host has no key. Edit it and pick one.")
  const k = await openKey(c, h.keyId)
  return { ...base, privateKey: k.privateKey, ...(k.passphrase && { passphrase: k.passphrase }) }
}

// One-use 60-second ticket the terminal sidecar redeems (scripts/ssh-terminal.ts).
export async function terminalTicket(c: Ctx, userId: string, hostId: string) {
  mustUse(c)
  const [h] = await db
    .select()
    .from(secretSshHosts)
    .where(and(eq(secretSshHosts.id, hostId), eq(secretSshHosts.projectId, c.projectId)))
  if (!h) throw bad("That host isn't here.", 404)
  const [j] = h.jumpHostId ? await db.select().from(secretSshHosts).where(eq(secretSshHosts.id, h.jumpHostId)) : []
  const t: Ticket = {
    userId,
    projectId: c.projectId,
    label: `${h.username}@${h.host}:${h.port}`,
    target: await hop(c, userId, h),
    ...(j && { jump: await hop(c, userId, j) }),
  }
  const id = randomBytes(24).toString("base64url")
  try {
    await redis.set(`ssh:ticket:${id}`, sealServer(JSON.stringify(t)), "EX", 60)
  } catch {
    throw new SecretsError(503, "Redis isn't reachable, so the terminal can't start.")
  }
  return { ticket: id, label: t.label, host: h.name }
}

export const openTicket = (sealed: string) => JSON.parse(openServer(sealed)) as Ticket

// The sidecar learned a host key: pin it (first connection only).
export async function pinHostKey(projectId: string, hostId: string, key: string) {
  await db
    .update(secretSshHosts)
    .set({ hostKey: key })
    .where(and(eq(secretSshHosts.id, hostId), eq(secretSshHosts.projectId, projectId), sql`${secretSshHosts.hostKey} is null`))
}

// ---------- push targets link to a stored key ----------

export async function pushKey(c: Ctx, keyId: string) {
  const k = await openKey(c, keyId)
  return { privateKey: k.privateKey, passphrase: k.passphrase ?? undefined }
}
