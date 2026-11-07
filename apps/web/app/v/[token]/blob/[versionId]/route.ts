import { limitIp } from "@/lib/api"
import { getRange } from "@/lib/s3"
import { findVaultLink, linkBlob } from "@/lib/vault-links"

const say = (status: number, headers?: HeadersInit) =>
  new Response(null, { status, headers })

// The ciphertext of one file in a vault link, with Range. It's useless without
// the link key, which never reaches this server.
// ponytail: per-IP 120/min for all public routes (limitIp); decryption is local,
// so wrong passphrases can't be rate-limited here. Argon2id is the brake.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; versionId: string }> }
) {
  const limited = await limitIp("vault-link")
  if (limited) return limited
  const { token, versionId } = await params
  const link = await findVaultLink(token)
  const blob = link && (await linkBlob(link.id, versionId))
  if (!blob) return say(404)

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }
  const range = req.headers.get("range") ?? undefined
  try {
    const r = await getRange(blob.key, range)
    if (r.contentRange) headers["Content-Range"] = r.contentRange
    if (r.length !== undefined) headers["Content-Length"] = String(r.length)
    return new Response(r.body, {
      status: r.contentRange && range ? 206 : 200,
      headers,
    })
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === "InvalidRange")
      return say(416, { "Content-Range": `bytes */${blob.size}` })
    // The bucket lost it (or it was just deleted).
    if (name === "NoSuchKey") return say(404)
    throw e
  }
}
