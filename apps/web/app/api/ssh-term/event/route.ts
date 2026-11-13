import { eq } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { pinHostKey } from "@/lib/secrets/ssh"
import { readToken } from "@/lib/upload-rules"

type Ev = {
  event: "start" | "end" | "pin" | "refused"
  userId: string
  projectId: string
  hostId: string
  label: string
  ip?: string
  seconds?: number
  key?: string
  message?: string
}

// Called by the terminal sidecar (scripts/ssh-terminal.ts) with a signed header:
// session start and end go to the audit log; a first-seen host key is pinned.
export async function POST(req: Request) {
  const proof = readToken<{ exp: number }>("ssh-term", req.headers.get("x-ssh-term"))
  if (!proof || proof.exp < Date.now()) return new Response(null, { status: 403 })
  const e = (await req.json().catch(() => null)) as Ev | null
  if (!e?.projectId || !e.userId) return new Response(null, { status: 400 })
  if (e.event === "pin" && e.key) {
    await pinHostKey(e.projectId, e.hostId, e.key)
    return Response.json({ ok: true })
  }
  const [u] = await db.select({ n: user.name, e: user.email }).from(user).where(eq(user.id, e.userId))
  const detail =
    e.event === "start"
      ? `opened a terminal to ${e.label}`
      : e.event === "end"
        ? `closed the terminal to ${e.label} after ${Math.max(0, Math.round(e.seconds ?? 0))}s`
        : `terminal to ${e.label} refused: ${(e.message ?? "").slice(0, 200)}`
  await auditAs({ id: e.userId, name: u?.n || u?.e || "?" }, `secrets_ssh_session_${e.event === "refused" ? "refused" : e.event}`, detail, {
    projectId: e.projectId,
    ip: e.ip ?? null,
  })
  return Response.json({ ok: true })
}
