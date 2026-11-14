// Where Secrets may connect out to, decided on the address a name resolves to (and that
// address is the one dialled, so DNS can't change between the check and the connection).
// - Webhooks and domain watch: public addresses only, unless an admin allows private ones
//   (Admin → Sharing → Secrets).
// - Database connections, server push and the SSH terminal: private addresses are what
//   self-hosters point these at, so they're allowed unless the server owner sets
//   SECRETS_BLOCK_PRIVATE=1. Nimbus's own Postgres and Redis (DATABASE_URL, REDIS_URL,
//   CACHE_URL) are always refused: any member can make a project and would otherwise
//   run commands on them.
// Relative imports only so node --test can load it.
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

import { isPrivateIp } from "../push-rules.ts"

export const blockPrivateHosts = () => process.env.SECRETS_BLOCK_PRIVATE === "1"

// Loopback and "any" both reach this machine, so they compare equal.
const here = (ip: string) => /^(127\.|0\.0\.0\.0$|::1?$|::ffff:127\.)/i.test(ip)
const key = (ip: string, port: number) => `${here(ip) ? "here" : ip.toLowerCase()}:${port}`

async function resolve(host: string) {
  const h = host.replace(/^\[|\]$/g, "")
  return isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => [])).map((a) => a.address)
}

let own: Promise<Set<string>> | null = null
function ownServices() {
  own ??= (async () => {
    const out = new Set<string>()
    for (const raw of [process.env.DATABASE_URL, process.env.REDIS_URL, process.env.CACHE_URL]) {
      if (!raw) continue
      try {
        const u = new URL(raw)
        const port = Number(u.port) || (u.protocol.startsWith("redis") ? 6379 : 5432)
        for (const ip of await resolve(u.hostname)) out.add(key(ip, port))
      } catch {}
    }
    return out
  })()
  return own
}

// The address to dial for host:port, or an Error saying why not.
export async function checkAddress(host: string, port: number, allowPrivate: boolean): Promise<string> {
  const ips = await resolve(host)
  if (!ips.length) throw new Error(`The host name “${host}” doesn't resolve.`)
  if (!allowPrivate && ips.some(isPrivateIp))
    throw new Error("That address is private, and this server only connects to public ones from Secrets.")
  const mine = await ownServices()
  if (ips.some((ip) => mine.has(key(ip, port))))
    throw new Error("That's this Nimbus server's own database or Redis. Point it at another server.")
  return ips[0]
}

// For tests: forget the cached own-service addresses.
export const resetOwn = () => void (own = null)
