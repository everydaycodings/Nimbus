// Self-hosted push for the Android app (UnifiedPush): the app registers an
// endpoint URL, and each new notification is POSTed there by the "push" job.
// The body names no files, only the notification id and a generic line.
import "server-only"

import { lookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import { isIP } from "node:net"

import { eq, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import { pushEndpoints } from "@/lib/db/schema"
import { isPrivateIp, pinnedLookup } from "@/lib/push-rules"

// Why this endpoint can't be used (or the address it resolved to, to connect
// to). Outside development, names that point at private addresses are refused,
// so a member can't aim the server at its own network.
async function checkEndpoint(
  raw: string
): Promise<{ problem: string | null; url?: URL; ip?: string }> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { problem: "That isn't a web address." }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { problem: "Use an http or https address." }
  if (url.username || url.password)
    return { problem: "Leave the login out of the address." }
  if (process.env.NODE_ENV !== "production") return { problem: null, url }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  try {
    const ips = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address)
    if (!ips.length || ips.some(isPrivateIp))
      return { problem: "That address points at a private network." }
    return { problem: null, url, ip: ips[0] }
  } catch {
    return { problem: "That address couldn't be found." }
  }
}

export const endpointProblem = async (raw: string) =>
  (await checkEndpoint(raw)).problem

// POST without redirects, connecting to `ip` (when given) instead of resolving
// the name again, which closes the DNS-rebinding gap after the check.
function post(url: URL, ip: string | undefined, body: string) {
  return new Promise<number>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10_000,
        ...(ip && { lookup: pinnedLookup(ip) as never }),
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on("timeout", () => req.destroy(new Error("timeout")))
    req.on("error", reject)
    req.end(body)
  })
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
      const { problem, url, ip } = await checkEndpoint(r.endpoint)
      if (problem || !url) return
      try {
        const status = await post(
          url,
          ip,
          JSON.stringify({
            app: "nimbus",
            id: notificationId,
            text: "You have new activity in Nimbus.",
          })
        )
        if (status === 404 || status === 410) gone.push(r.id)
        else if (status >= 200 && status < 300) sent.push(r.id)
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
