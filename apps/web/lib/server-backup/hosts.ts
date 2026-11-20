// Servers Nimbus backs up: added with their own SSH key (shown to put in authorized_keys), tested to record the host key,
// or a push agent, or this Nimbus server. Every function takes the member's id and only touches their rows.
import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { and, count, eq, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { serverBackupHosts, serverBackupJobs } from "@/lib/db/schema"
import { allowedTarget, dockerSocket, exec, missingBinary, sshProblem, withTransport, type Host } from "./exec"
import { fingerprint, HOST_RE, newKeyPair, pickHostKey, USER_RE, VOLUME_RE } from "./rules"

export type HostView = {
  id: string
  label: string
  host: string
  port: number
  username: string
  mode: "ssh" | "agent"
  isSelf: boolean
  publicKey: string | null
  fingerprint: string | null
  jobs: number
}

const UUID = /^[0-9a-f-]{36}$/i
export const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex")

export async function ownedHost(userId: string, id: string): Promise<Host | null> {
  if (!UUID.test(id)) return null
  const [h] = await db.select().from(serverBackupHosts).where(and(eq(serverBackupHosts.id, id), eq(serverBackupHosts.userId, userId)))
  return h ?? null
}

export async function listHosts(userId: string): Promise<HostView[]> {
  const rows = await db
    .select({ h: serverBackupHosts, jobs: sql<number>`(select count(*)::int from ${serverBackupJobs} j where j.host_id = ${serverBackupHosts.id})` })
    .from(serverBackupHosts)
    .where(eq(serverBackupHosts.userId, userId))
    .orderBy(serverBackupHosts.createdAt)
  return rows.map(({ h, jobs }) => ({
    id: h.id, label: h.label, host: h.host, port: h.port, username: h.username, mode: h.mode, isSelf: h.isSelf,
    publicKey: h.publicKey, fingerprint: h.hostKey ? fingerprint(h.hostKey) : null, jobs,
  }))
}

export type NewHost = { label: string; host: string; port: number; username: string; mode: "ssh" | "agent" }

export async function addHost(userId: string, admin: boolean, v: NewHost): Promise<{ id?: string; token?: string; publicKey?: string; error?: string }> {
  const label = String(v.label ?? "").trim().replace(/\s+/g, " ")
  if (!label || label.length > 60) return { error: "Give the server a name of up to 60 characters." }
  const mode = v.mode === "agent" ? "agent" : "ssh"
  let host = ""
  let port = 22
  let username = "root"
  if (mode === "ssh") {
    host = String(v.host ?? "").trim()
    port = Number(v.port)
    username = String(v.username ?? "").trim()
    if (!host || host.length > 253 || !HOST_RE.test(host)) return { error: "Enter the server's host name or IP address." }
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "The port must be between 1 and 65535." }
    if (!USER_RE.test(username)) return { error: "Enter the SSH user name." }
    const bad = await allowedTarget(host, admin)
    if (bad) return { error: bad }
  }
  const [dup] = await db.select({ id: serverBackupHosts.id }).from(serverBackupHosts).where(and(eq(serverBackupHosts.userId, userId), sql`lower(${serverBackupHosts.label}) = ${label.toLowerCase()}`))
  if (dup) return { error: `You already have a server called “${label}”.` }
  const key = mode === "ssh" ? newKeyPair(`nimbus-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`) : null
  const token = mode === "agent" ? `nsb_${randomBytes(24).toString("base64url")}` : null
  const [h] = await db
    .insert(serverBackupHosts)
    .values({ userId, label, host, port, username, mode, privateKeyEnc: key ? encrypt(key.privateKey) : null, publicKey: key?.publicKey ?? null, agentTokenHash: token ? tokenHash(token) : null })
    .returning({ id: serverBackupHosts.id })
  await audit("server_backup_host_add", { detail: `${label} (${mode})` })
  return { id: h.id, token: token ?? undefined, publicKey: key?.publicKey }
}

// This Nimbus server: admins only, one per admin.
export async function addSelf(userId: string, admin: boolean): Promise<{ id?: string; error?: string }> {
  if (!admin) return { error: "Only an admin can back up this server." }
  const [have] = await db.select({ id: serverBackupHosts.id }).from(serverBackupHosts).where(and(eq(serverBackupHosts.userId, userId), eq(serverBackupHosts.isSelf, true)))
  if (have) return { id: have.id }
  const [h] = await db.insert(serverBackupHosts).values({ userId, label: "This Nimbus server", isSelf: true, mode: "ssh", host: "", username: "" }).returning({ id: serverBackupHosts.id })
  await audit("server_backup_host_add", { detail: "This Nimbus server" })
  return { id: h.id }
}

export async function newAgentToken(userId: string, id: string): Promise<{ token?: string; error?: string }> {
  const h = await ownedHost(userId, id)
  if (!h || h.mode !== "agent") return { error: "That server isn't here." }
  const token = `nsb_${randomBytes(24).toString("base64url")}`
  await db.update(serverBackupHosts).set({ agentTokenHash: tokenHash(token) }).where(eq(serverBackupHosts.id, id))
  return { token }
}

export async function deleteHost(userId: string, id: string): Promise<{ error?: string }> {
  const h = await ownedHost(userId, id)
  if (!h) return {}
  const [{ n }] = await db.select({ n: count() }).from(serverBackupJobs).where(eq(serverBackupJobs.hostId, id))
  if (n) return { error: "Delete this server's backup jobs first." }
  await db.delete(serverBackupHosts).where(eq(serverBackupHosts.id, id))
  await audit("server_backup_host_delete", { detail: h.label })
  return {}
}

export type TestResult = { error?: string; ok?: boolean; fingerprint?: string; keyType?: string; recorded?: boolean; changed?: { fingerprint: string }; docker?: boolean }

// Scans the server's host key and logs in with Nimbus's key. The first good test records the host key; after that a
// different key is refused until the member trusts the new one (`trustNew`).
export async function testHost(userId: string, id: string, trustNew = false): Promise<TestResult> {
  const h = await ownedHost(userId, id)
  if (!h) return { error: "That server isn't here." }
  if (h.isSelf) {
    const sock = await dockerSocket()
    return { ok: true, docker: sock }
  }
  if (h.mode === "agent") return { error: "A push agent connects by itself; there is nothing to test." }
  const scan = await exec({ file: "ssh-keyscan", args: ["-T", "10", "-p", String(h.port), h.host] }, { timeout: 20_000 })
  const miss = missingBinary(scan, "ssh-keyscan")
  if (miss) return { error: miss }
  const scanned = pickHostKey(scan.out)
  if (!scanned) return { error: `Couldn't read a host key from ${h.host}:${h.port}. Is SSH running there?` }
  if (h.hostKey && h.hostKey !== scanned && !trustNew) {
    // Several key types may be offered; the stored one still matching is fine.
    const all = scan.out.split("\n").map((l) => l.trim().split(/\s+/).slice(1, 3).join(" "))
    if (!all.includes(h.hostKey)) return { error: sshProblem("Host key verification failed", h), changed: { fingerprint: fingerprint(scanned) } }
  }
  const pinned: Host = { ...h, hostKey: trustNew || !h.hostKey ? scanned : h.hostKey }
  const r = await withTransport(pinned, async (t) => {
    const hello = await exec(t("echo nimbus-ok; if command -v docker >/dev/null 2>&1; then echo docker; fi"), { timeout: 30_000 })
    return hello
  })
  if (r.code !== 0 || !r.out.includes("nimbus-ok")) return { error: sshProblem(r.err, h), fingerprint: fingerprint(scanned) }
  let recorded = false
  if (pinned.hostKey !== h.hostKey) {
    await db.update(serverBackupHosts).set({ hostKey: pinned.hostKey }).where(eq(serverBackupHosts.id, id))
    recorded = true
    await audit("server_backup_host_trust", { detail: `${h.label}: ${fingerprint(pinned.hostKey!)}` })
  }
  return { ok: true, recorded, fingerprint: fingerprint(pinned.hostKey!), keyType: pinned.hostKey!.split(" ")[0], docker: r.out.includes("docker") }
}

// Docker volumes on the server, for the wizard's picker.
export async function listVolumes(userId: string, id: string): Promise<{ volumes?: string[]; error?: string }> {
  const h = await ownedHost(userId, id)
  if (!h || h.mode === "agent") return { error: "That server isn't here." }
  if (h.isSelf && !(await dockerSocket())) return { error: "The Docker socket isn't mounted in this Nimbus container." }
  try {
    const r = await withTransport(h, (t) => exec(t("docker volume ls --format json"), { timeout: 30_000 }))
    if (r.code !== 0) return { error: /not found|permission denied/i.test(r.err) ? `Docker isn't usable for ${h.username || "this user"} on ${h.label}: ${r.err.trim().split("\n").pop()}` : sshProblem(r.err, h) }
    const names = r.out.split("\n").filter(Boolean).map((l) => {
      try {
        return String(JSON.parse(l).Name)
      } catch {
        return ""
      }
    })
    return { volumes: names.filter((n) => VOLUME_RE.test(n)).sort() }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
