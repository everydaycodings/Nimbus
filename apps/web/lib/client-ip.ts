// The caller's IP. nginx sets X-Real-IP to $remote_addr; the first X-Forwarded-For entry is
// whatever the client sent, so only the last one (added by our proxy) is trusted.
export const ipFrom = (h: Headers | undefined | null) =>
  h?.get("x-real-ip")?.trim() || h?.get("x-forwarded-for")?.split(",").at(-1)?.trim() || null
