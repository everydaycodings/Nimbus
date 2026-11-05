// Self-hosted push for the Android app (UnifiedPush): the app registers an
// endpoint URL, and each new notification is POSTed there by the "push" job.
// The body names no files, only the notification id and a generic line.
import "server-only"

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

import { eq, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import { pushEndpoints } from "@/lib/db/schema"
import { isPrivateIp } from "@/lib/push-rules"

// Why this endpoint can't be used, or null. Outside development, names that
// point at private addresses are refused, so a member can't aim the server at
// its own network.
// ponytail: checked at registration and again at send time, not pinned between
// the lookup and the connection; pin the resolved IP if DNS rebinding matters.
export async function endpointProblem(raw: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "That isn't a web address."
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return "Use an http or https address."
  if (url.username || url.password) return "Leave the login out of the address."
  if (process.env.NODE_ENV !== "production") return null
  const host = url.hostname.replace(/^\[|\]$/g, "")
  try {
    const ips = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address)
    if (!ips.length || ips.some(isPrivateIp))
      return "That address points at a private network."
  } catch {
    return "That address couldn't be found."
  }
  return null
}

export async function sendPush(userId: string, notificationId: string) {
  const rows = await db
    .select()
    .from(pushEndpoints)
    .where(eq(pushEndpoints.userId, userId))
  const gone: string[] = []
  const sent: string[] = []
  await Promise.all(
    rows.map(async (r) => {
      if (await endpointProblem(r.endpoint)) return
      try {
        const res = await fetch(r.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app: "nimbus",
            id: notificationId,
            text: "You have new activity in Nimbus.",
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 404 || res.status === 410) gone.push(r.id)
        else if (res.ok) sent.push(r.id)
      } catch {
        // Unreachable now; the next notification tries again.
      }
    })
  )
  if (gone.length)
    await db.delete(pushEndpoints).where(inArray(pushEndpoints.id, gone))
  if (sent.length)
    await db
      .update(pushEndpoints)
      .set({ lastUsedAt: new Date() })
      .where(inArray(pushEndpoints.id, sent))
}
