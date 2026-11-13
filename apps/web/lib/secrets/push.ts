// Server push: writes an environment's .env to a host over SSH (a temp file, 0600, then
// a rename, so a reader never sees half a file), then runs an optional command. The
// private key is sealed with the project key. S4's stored SSH keys can replace keyEnc.
import "server-only"

import { createHash } from "node:crypto"

import { eq } from "drizzle-orm"
import { Client, utils } from "ssh2"

import { db } from "@/lib/db"
import { secretEnvs, secretPushTargets } from "@/lib/db/schema"
import { serialize } from "./format"
import { openValue, sealValue } from "./kms"
import { SecretsError, exportPairs, systemCtx, type Ctx } from "./service"

export type PushInput = {
  host: string
  port: number
  username: string
  path: string
  privateKey?: string
  postCommand: string
  auto: boolean
  // Accept whatever host key the server presents next time (after a re-install).
  forgetHostKey?: boolean
}

export async function getPush(envId: string) {
  const [t] = await db.select().from(secretPushTargets).where(eq(secretPushTargets.envId, envId))
  if (!t) return null
  return {
    host: t.host,
    port: t.port,
    username: t.username,
    path: t.path,
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
  let keyEnc = old?.keyEnc
  if (i.privateKey?.trim()) {
    const k = utils.parseKey(i.privateKey.trim())
    if (k instanceof Error)
      throw new SecretsError(400, /passphrase/i.test(k.message) ? "Keys with a passphrase aren't supported yet." : "That isn't a private key we can read.")
    keyEnc = sealValue(c.key, c.projectId, i.privateKey.trim() + "\n")
  }
  if (!keyEnc) throw new SecretsError(400, "Paste the private key to log in with.")
  const moved = old && (old.host !== host || old.port !== i.port)
  const v = {
    host,
    port: i.port,
    username: i.username.trim(),
    path,
    keyEnc,
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

function run(conn: Client, cmd: string, stdin?: string) {
  return new Promise<{ code: number; out: string }>((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ""
      stream.on("data", (d: Buffer) => (out += d))
      stream.stderr.on("data", (d: Buffer) => (out += d))
      stream.on("close", (code: number | null) => resolve({ code: code ?? 1, out: out.trim() }))
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
  const privateKey = openValue(c.key, c.projectId, t.keyEnc)
  let seen: string | undefined
  let mismatch = false
  const conn = new Client()
  try {
    await new Promise<void>((resolve, reject) => {
      conn.on("ready", resolve).on("error", reject)
      conn.connect({
        host: t.host,
        port: t.port,
        username: t.username,
        privateKey,
        readyTimeout: 15_000,
        // First connection pins the host key; a different one later is refused.
        hostVerifier: (key: Buffer) => {
          seen = createHash("sha256").update(key).digest("base64")
          if (t.hostKey && t.hostKey !== seen) return (mismatch = true), false
          return true
        },
      })
    })
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
    return await record(true, message, t.hostKey ? undefined : seen)
  } catch (err) {
    const message = mismatch
      ? "The server's host key changed. If that's expected, edit the push and tick “Trust a new host key”."
      : (err as Error).message
    await record(false, message)
    throw new Error(message)
  } finally {
    conn.end()
  }
}
