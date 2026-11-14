// The container registry. Next only routes standard methods and mangles raw paths, so
// scripts/registry.ts forwards every request here as a POST carrying the real method and
// URL, plus a proof that nothing else can pose as it.
import { signIn } from "@/lib/registry/auth"
import { dispatch } from "@/lib/registry/dispatch"
import { RegError, errorResponse } from "@/lib/registry/http"
import { endpoint } from "@/lib/registry/rules"
import { getSettings } from "@/lib/signup"
import { readToken } from "@/lib/upload-rules"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const proof = readToken<{ exp: number }>("registry", req.headers.get("x-cr-proxy"))
  if (!proof || proof.exp < Date.now()) return new Response(null, { status: 404 })
  const method = req.headers.get("x-cr-method")?.toUpperCase() ?? ""
  const url = req.headers.get("x-cr-url") ?? "/"
  const [path, ...rest] = url.split("?")
  const head = method === "HEAD"
  try {
    if (!endpoint() || !(await getSettings()).registry)
      throw new RegError("UNSUPPORTED", "The container registry isn't turned on on this server.", 503)
    const ip = req.headers.get("x-cr-ip") || null
    const { actor, name } = await signIn(req.headers.get("authorization"), ip)
    return await dispatch({ req, method, path, q: new URLSearchParams(rest.join("?")), actor, who: { name, ip } })
  } catch (e) {
    if (e instanceof RegError) return errorResponse(e, head)
    console.error(`[registry] ${method} ${url}:`, e)
    return errorResponse(new RegError("UNSUPPORTED", "Internal error.", 500), head)
  }
}
