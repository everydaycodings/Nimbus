// Leak scanning of members' files. The worker scans a new upload (job leak-scan) or all
// of a member's files on request (leak-scan-user); findings keep a line, a masked preview
// and a hash, never the match. Move to Secrets and redact re-read the file to get the
// match back in memory.
import "server-only"

import { randomBytes } from "node:crypto"

import { GetObjectCommand } from "@aws-sdk/client-s3"
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { nodes, secretLeakAllow, secretLeaks, settings } from "@/lib/db/schema"
import { BUCKET, putObject, s3 } from "@/lib/s3"
import { addVersion } from "@/lib/uploads"
import { RULES, SUGGESTED_KEY, looksBinary, redact, scanText, scannable } from "./leak-rules"
import { tell } from "./notices"
import { SecretsError, applyOps, projectCtx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m, undefined)

export const leakScanEnabled = async () =>
  (await db.select({ on: settings.secretLeakScan }).from(settings))[0]?.on ?? true

async function fileText(nodeId: string, ownerId?: string) {
  const [n] = await db
    .select({ id: nodes.id, name: nodes.name, ownerId: nodes.ownerId, parentId: nodes.parentId, kind: nodes.kind, vaultId: nodes.vaultId, trashedAt: nodes.trashedAt, s3Key: nodes.s3Key, size: nodes.size, mime: nodes.mime })
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), ownerId ? eq(nodes.ownerId, ownerId) : undefined))
  if (!n || n.kind !== "file" || n.vaultId || n.trashedAt || !n.s3Key) return null
  if (!scannable(n.name, n.mime, n.size)) return { n, text: null }
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: n.s3Key }))
  const bytes = await r.Body!.transformToByteArray()
  return { n, text: looksBinary(bytes) ? null : new TextDecoder().decode(bytes) }
}

const allowOf = async (userId: string) =>
  new Set((await db.select({ h: secretLeakAllow.hash }).from(secretLeakAllow).where(eq(secretLeakAllow.userId, userId))).map((r) => r.h))

// Scans one file: new findings are saved, open ones that are gone are cleared. Returns how many are new.
export async function scanNode(nodeId: string, o: { notice?: boolean } = {}) {
  if (!(await leakScanEnabled())) return 0
  const f = await fileText(nodeId)
  if (!f) return 0
  const found = f.text === null ? [] : scanText(f.text, await allowOf(f.n.ownerId))
  const fresh = found.length
    ? await db
        .insert(secretLeaks)
        .values(found.map((x) => ({ ownerId: f.n.ownerId, nodeId, rule: x.rule, line: x.line, masked: x.masked, hash: x.hash })))
        .onConflictDoNothing()
        .returning({ id: secretLeaks.id })
    : []
  await db
    .delete(secretLeaks)
    .where(and(eq(secretLeaks.nodeId, nodeId), eq(secretLeaks.status, "open"), found.length ? notInArray(secretLeaks.hash, found.map((x) => x.hash)) : undefined))
  if (fresh.length && o.notice !== false)
    await tell([f.n.ownerId], null, `Nimbus found ${fresh.length} possible secret${fresh.length === 1 ? "" : "s"} in ${f.n.name}. Review ${fresh.length === 1 ? "it" : "them"}.`, "/secrets/leaks")
  return fresh.length
}

const MAX_FILES = 5000

// "Scan my files": every scannable file the member owns, one bell notice at the end.
export async function scanUser(userId: string) {
  if (!(await leakScanEnabled())) return { files: 0, found: 0 }
  const files = await db
    .select({ id: nodes.id, name: nodes.name, mime: nodes.mime, size: nodes.size })
    .from(nodes)
    .where(and(eq(nodes.ownerId, userId), eq(nodes.kind, "file"), isNull(nodes.vaultId), isNull(nodes.trashedAt), sql`${nodes.size} > 0`))
    .orderBy(desc(nodes.updatedAt))
    .limit(MAX_FILES)
  let found = 0
  let files_ = 0
  for (const f of files) {
    if (!scannable(f.name, f.mime, f.size)) continue
    files_++
    found += await scanNode(f.id, { notice: false }).catch((e) => (console.error("leak scan", f.id, e), 0))
  }
  if (found) await tell([userId], null, `Scanned ${files_} file${files_ === 1 ? "" : "s"}: ${found} new possible secret${found === 1 ? "" : "s"}. Review them.`, "/secrets/leaks")
  return { files: files_, found }
}

export type LeakRow = {
  id: string
  nodeId: string
  file: string
  href: string
  rule: string
  label: string
  line: number
  masked: string
  status: string
  suggestedKey: string
}

export async function listLeaks(userId: string, status: "open" | "closed") {
  const rows = await db
    .select({ l: secretLeaks, name: nodes.name, parentId: nodes.parentId })
    .from(secretLeaks)
    .innerJoin(nodes, eq(nodes.id, secretLeaks.nodeId))
    .where(and(eq(secretLeaks.ownerId, userId), status === "open" ? eq(secretLeaks.status, "open") : sql`${secretLeaks.status} <> 'open'`))
    .orderBy(desc(secretLeaks.createdAt))
    .limit(500)
  return rows.map(({ l, name, parentId }): LeakRow => ({
    id: l.id,
    nodeId: l.nodeId,
    file: name,
    href: `${parentId ? `/folders/${parentId}` : "/"}?open=${l.nodeId}`,
    rule: l.rule,
    label: RULES.find((r) => r.id === l.rule)?.label ?? l.rule,
    line: l.line,
    masked: l.masked,
    status: l.status,
    suggestedKey: SUGGESTED_KEY[l.rule] ?? "SECRET_VALUE",
  }))
}

export const openLeakCount = async (userId: string) =>
  (await db.execute<{ n: number }>(sql`select count(*)::int as n from secret_leaks where owner_id = ${userId} and status = 'open'`))[0].n

async function mine(userId: string, id: string) {
  const [l] = await db.select().from(secretLeaks).where(and(eq(secretLeaks.id, id), eq(secretLeaks.ownerId, userId)))
  if (!l) throw bad("That finding isn't here.", 404)
  return l
}

export async function resolveLeak(userId: string, id: string, action: "dismiss" | "false_positive" | "reopen") {
  const l = await mine(userId, id)
  if (action === "false_positive")
    await db.insert(secretLeakAllow).values({ userId, hash: l.hash }).onConflictDoNothing()
  if (action === "reopen")
    await db.delete(secretLeakAllow).where(and(eq(secretLeakAllow.userId, userId), eq(secretLeakAllow.hash, l.hash)))
  await db
    .update(secretLeaks)
    .set({ status: action === "dismiss" ? "dismissed" : action === "false_positive" ? "false_positive" : "open" })
    .where(eq(secretLeaks.id, id))
  // A false positive also clears the same text in the member's other files.
  if (action === "false_positive")
    await db.update(secretLeaks).set({ status: "false_positive" }).where(and(eq(secretLeaks.ownerId, userId), eq(secretLeaks.hash, l.hash), eq(secretLeaks.status, "open")))
}

// Creates a secret holding the text the finding points at, and with `redact` writes the file
// again with that text replaced (a new version, so the old one is still there to restore).
export async function moveLeak(userId: string, id: string, o: { projectId: string; envId: string; key: string; redact: boolean }) {
  const l = await mine(userId, id)
  if (l.status === "moved") throw bad("That one is already in Secrets.", 409)
  const c = await projectCtx(userId, o.projectId)
  if (!c) throw bad("That project isn't here, or you can't open it.", 404)
  const f = await fileText(l.nodeId, userId)
  const hit = f?.text ? scanText(f.text).find((x) => x.hash === l.hash) : null
  if (!f || !hit) throw bad("That file changed and the text is no longer there. Scan again.", 409)
  const r = await applyOps(c, o.envId, null, [{ key: o.key, value: hit.match }], [], "strict", { via: "import" })
  await audit("secrets_leak_move", { detail: `${f.n.name} line ${l.line} (${l.rule}) to ${o.key}${r.request ? ", waiting for review" : ""}` })
  let redacted = false
  if (o.redact && !r.request) {
    const next = redact(f.text!, hit.match)
    const key = `redact-${randomBytes(16).toString("hex")}`
    const body = new TextEncoder().encode(next)
    await putObject(key, body, f.n.mime ?? "text/plain")
    await db.transaction(async (tx) => {
      const v = await addVersion(tx, f.n.id, { s3Key: key, size: body.length, mime: f.n.mime, uploadedBy: userId, note: "Secret moved to Secrets" })
      await tx.update(nodes).set({ currentVersionId: v.id, s3Key: key, size: body.length, updatedAt: new Date() }).where(eq(nodes.id, f.n.id))
    })
    redacted = true
  }
  if (!r.request) await db.update(secretLeaks).set({ status: "moved" }).where(eq(secretLeaks.id, id))
  return { request: r.request ?? null, redacted }
}

