// The health worker (scripts/worker.ts) calls this on the admin's interval.
// The probes live here, in the app, because they reuse its email, storage and
// settings code; the worker only keeps time.
import { runChecks } from "@/lib/health"
import { readToken } from "@/lib/upload-rules"

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "")
  const t = readToken("health", token)
  if (!t || t.exp < Date.now()) return new Response(null, { status: 401 })
  const results = await runChecks()
  return Response.json({
    failed: results.filter((r) => r.outcome === "fail").map((r) => r.service),
  })
}
