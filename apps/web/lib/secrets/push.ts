// Server push: writes an environment's .env to a host over SSH (a temp file, 0600, then
// a rename, so a reader never sees half a file), then runs an optional command. The
// private key is sealed with the project key, or comes from a stored SSH key (keyId).
// When the SSH tab has an entry for the same host and port with a jump host, the push goes
// through that jump host (its own key or CA certificate, its pinned host key).
// The command runs on the target server as the push's SSH user, never on Nimbus.
import "server-only"

import { and, eq, isNotNull } from "drizzle-orm"
import { type Client, utils } from "ssh2"

import { db } from "@/lib/db"
import { secretEnvs, secretPushTargets, secretSshHosts } from "@/lib/db/schema"
import { blockPrivateHosts, checkAddress } from "./egress"
import { serialize } from "./format"
import { openValue, sealValue } from "./kms"
import { hop, openKey, pinHostKey } from "./ssh"
import { connectHop, forward, type Seen } from "./ssh-cert-auth"
import { SecretsError, exportPairs, systemCtx, type Ctx } from "./service"

export type PushInput = {
  host: string
  port: number
  username: string
  path: string
  privateKey?: string
  // A key stored on the SSH tab; wins over privateKey.
  keyId?: string
  postCommand: string
  auto: boolean
  // Accept whatever host key the server presents next time (after a re-install).
  forgetHostKey?: boolean
}

// The SSH tab's jump host for host:port in this project, if an entry there has one.
async function jumpFor(projectId: string, host: string, port: number) {
  const [h] = await db
    .select({ j: secretSshHosts.jumpHostId })
    .from(secretSshHosts)
    .where(and(eq(secretSshHosts.projectId, projectId), eq(secretSshHosts.host, host), eq(secretSshHosts.port, port), isNotNull(secretSshHosts.jumpHostId)))
    .limit(1)
  if (!h?.j) return null
  const [j] = await db.select().from(secretSshHosts).where(and(eq(secretSshHosts.id, h.j), eq(secretSshHosts.projectId, projectId)))
  return j ?? null
}

export async function getPush(envId: string) {
  const [t] = await db.select().from(secretPushTargets).where(eq(secretPushTargets.envId, envId))
  if (!t) return null
  const [e] = await db.select({ p: secretEnvs.projectId }).from(secretEnvs).where(eq(secretEnvs.id, envId))
  const via = e ? await jumpFor(e.p, t.host, t.port) : null
  return {
    via: via?.name ?? null,
    host: t.host,
    port: t.port,
    username: t.username,
    path: t.path,
    keyId: t.keyId,
    postCommand: t.postCommand ?? "",
    auto: t.auto,
    hostKey: t.hostKey,
    lastAt: t.lastAt?.toISOString() ?? null,
    lastOk: t.lastOk,
    lastMessage: t.lastMessage,
  }
}

export async function savePush(c: Ctx, envId: string, i: PushInput) {
  const host = i.host.trim()
  const path = i.path.trim()
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) throw new SecretsError(400, "Enter a host name or IP address.")
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(i.username.trim())) throw new SecretsError(400, "Enter the SSH user name.")
  if (!path || path.length > 300 || /[\0\n]/.test(path)) throw new SecretsError(400, "Enter the file path on the server.")
  if (i.port < 1 || i.port > 65535) throw new SecretsError(400, "The port is 1 to 65535.")
  const [old] = await db.select().from(secretPushTargets).where(eq(secretPushTargets.envId, envId))
  let keyEnc = old?.keyEnc ?? null
  const keyId = i.keyId ? i.keyId : i.privateKey?.trim() ? null : (old?.keyId ?? null)
  if (i.keyId) {
    await openKey(c, i.keyId) // 404 if it isn't this project's
    keyEnc = null
  } else if (i.privateKey?.trim()) {
    const k = utils.parseKey(i.privateKey.trim())
    if (k instanceof Error)
      throw new SecretsError(400, /passphrase/i.test(k.message) ? "Keys with a passphrase aren't supported yet." : "That isn't a private key we can read.")
    keyEnc = sealValue(c.key, c.projectId, i.privateKey.trim() + "\n")
  }
  if (!keyEnc && !keyId) throw new SecretsError(400, "Paste the private key to log in with.")
  const moved = old && (old.host !== host || old.port !== i.port)
  const v = {
    host,
    port: i.port,
    username: i.username.trim(),
    path,
    keyEnc,
    keyId,
    postCommand: i.postCommand.trim().slice(0, 500) || null,
    auto: i.auto,
    hostKey: moved || i.forgetHostKey ? null : (old?.hostKey ?? null),
  }
  await db
    .insert(secretPushTargets)
    .values({ envId, ...v })
    .onConflictDoUpdate({ target: secretPushTargets.envId, set: v })
}

export const deletePush = (envId: string) =>
  db.delete(secretPushTargets).where(eq(secretPushTargets.envId, envId))

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// "~/app/.env" must still expand on the server.
const remotePath = (p: string) => (p.startsWith("~/") ? `"$HOME"/${sh(p.slice(2))}` : sh(p))

const RUN_MS = 120_000
const KEEP = 4096

// Runs one command: its last 4 KB of output kept, stopped after two minutes.
function run(conn: Client, cmd: string, stdin?: string) {
  return new Promise<{ code: number; out: string }>((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ""
      const keep = (d: Buffer) => void (out = (out + d).slice(-KEEP))
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error(`It didn't finish in ${RUN_MS / 1000} seconds.`))
      }, RUN_MS)
      stream.on("data", keep)
      stream.stderr.on("data", keep)
      stream.on("close", (code: number | null) => {
        clearTimeout(timer)
        resolve({ code: code ?? 1, out: out.trim() })
      })
      stream.end(stdin)
    })
  })
}

// Pushes now. Resolves { ok, message } and records it on the target; throws only for the worker to retry.
export async function runPush(envId: string): Promise<{ ok: boolean; message: string }> {
  const [t] = await db.select().from(secretPushTargets).where(eq(secretPushTargets.envId, envId))
  if (!t) return { ok: false, message: "No server push is set up for this environment." }
  const [e] = await db.select().from(secretEnvs).where(eq(secretEnvs.id, envId))
  const c = await systemCtx(e.projectId)
  if (!c) return { ok: false, message: "That project is gone." }
  const record = async (ok: boolean, message: string, hostKey?: string) => {
    await db
      .update(secretPushTargets)
      .set({ lastAt: new Date(), lastOk: ok, lastMessage: message.slice(0, 500), ...(hostKey && { hostKey }) })
      .where(eq(secretPushTargets.envId, envId))
    return { ok, message }
  }

  const text = serialize(await exportPairs(c, { envId, folderId: null }, { expand: true, own: false }), "env")
  if (!t.keyId && !t.keyEnc) return record(false, "The stored SSH key was deleted. Edit the push and pick another key.")
  const stored = t.keyId ? await openKey(c, t.keyId) : null
  const privateKey = stored ? stored.privateKey : openValue(c.key, c.projectId, t.keyEnc!)
  const passphrase = stored?.passphrase ?? undefined
  const seen: Seen = {}
  const seenJ: Seen = {}
  const conns: Client[] = []
  try {
    const j = await jumpFor(c.projectId, t.host, t.port)
    // The first hop is dialled from here, so it's checked (lib/secrets/egress.ts).
    const first = j ?? t
    const dial = await checkAddress(first.host, first.port, !blockPrivateHosts())
    let sock: Awaited<ReturnType<typeof forward>> | undefined
    if (j) {
      const via = await connectHop({ ...(await hop(c, c.userId, j)), dial }, undefined, seenJ).catch((e: Error) => {
        throw new Error(seenJ.mismatch ? `The jump host ${j.name}'s host key changed. If that's expected, edit it on the SSH tab and tick “Trust a new host key”.` : `Jump host ${j.name}: ${e.message}`)
      })
      conns.push(via)
      if (!j.hostKey && seenJ.key) await pinHostKey(c.projectId, j.id, seenJ.key)
      sock = await forward(via, t.host, t.port)
    }
    // First connection pins the host key; a different one later is refused.
    const conn = await connectHop(
      { host: t.host, dial: j ? undefined : dial, port: t.port, username: t.username, hostId: "", hostKey: t.hostKey, privateKey, passphrase },
      sock,
      seen
    )
    conns.push(conn)
    const w = await run(
      conn,
      `umask 077; f=${remotePath(t.path)}; tmp="$f.nimbus.$$"; cat > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$f" || { rm -f "$tmp"; exit 1; }`,
      text
    )
    if (w.code) throw new Error(`Writing ${t.path} failed: ${w.out || `exit ${w.code}`}`)
    let message = `Wrote ${t.path}`
    if (t.postCommand) {
      const r = await run(conn, t.postCommand)
      if (r.code) throw new Error(`${message}, but the command exited ${r.code}: ${r.out.slice(-300)}`)
      message += ", ran the command"
    }
    return await record(true, message, t.hostKey ? undefined : seen.key)
  } catch (err) {
    const message = seen.mismatch
      ? "The server's host key changed. If that's expected, edit the push and tick “Trust a new host key”."
      : (err as Error).message
    await record(false, message)
    throw new Error(message)
  } finally {
    for (const x of conns) x.end()
  }
}

// Every environment's target in a project, for the CLI's `push list` (never the key).
export async function listPushes(projectId: string) {
  const rows = await db
    .select({ t: secretPushTargets, slug: secretEnvs.slug })
    .from(secretPushTargets)
    .innerJoin(secretEnvs, eq(secretEnvs.id, secretPushTargets.envId))
    .where(eq(secretEnvs.projectId, projectId))
    .orderBy(secretEnvs.position)
  return rows.map(({ t, slug }) => ({
    env: slug,
    host: t.host,
    port: t.port,
    username: t.username,
    path: t.path,
    auto: t.auto,
    lastAt: t.lastAt?.toISOString() ?? null,
    lastOk: t.lastOk,
    lastMessage: t.lastMessage,
  }))
}
