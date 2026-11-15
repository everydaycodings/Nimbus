import { badgeFor } from "@/lib/registry/badge"
import { badgeSvg } from "@/lib/registry/badge-svg"

export const dynamic = "force-dynamic"

// GET /api/registry/badge/<namespace>/<repo>.svg?tag=latest&token=…&show=size
// Public repositories need nothing; a private one answers "build | none" unless the token matches.
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const q = new URL(req.url).searchParams
  const full = path.map(decodeURIComponent).join("/").replace(/\.svg$/, "")
  const svg = badgeSvg(await badgeFor(full, { tag: q.get("tag")?.slice(0, 128), token: q.get("token")?.slice(0, 100), show: q.get("show") }))
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } })
}
