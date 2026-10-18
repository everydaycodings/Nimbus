// Short-lived reads on their own Redis database (CACHE_URL, /1), apart from the
// queues on /0, so `redis-cli -n 1 flushdb` clears it safely. Every key expires.
// Without CACHE_URL, or while Redis is away, reads go to the source.
import { Redis } from "ioredis"

const url = process.env.CACHE_URL
const globalForCache = globalThis as unknown as { cache?: Redis }
const client = url
  ? (globalForCache.cache ??
    new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 }))
  : null
client?.on("error", () => {})
if (client && process.env.NODE_ENV !== "production") globalForCache.cache = client

// Only for values that are fine to show up to `seconds` old.
export async function cached<T>(
  key: string,
  seconds: number,
  load: () => Promise<T>
): Promise<T> {
  if (!client) return load()
  try {
    const hit = await client.get(key)
    if (hit !== null) return JSON.parse(hit) as T
  } catch {
    return load()
  }
  const value = await load()
  client.set(key, JSON.stringify(value), "EX", seconds).catch(() => {})
  return value
}
