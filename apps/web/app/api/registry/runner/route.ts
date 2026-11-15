// The build runner's way into the app (scripts/registry-build.ts): one POST {op, ...} with a short-lived
// signed token. Everything that needs the database, Secrets, the registry or Trivy happens here.
import * as ops from "@/lib/registry/build-ops"
import { readToken } from "@/lib/upload-rules"

export const dynamic = "force-dynamic"
export const maxDuration = 900

export async function POST(req: Request) {
  const t = readToken("registry-build", req.headers.get("authorization")?.replace(/^Bearer /, ""))
  if (!t || t.exp < Date.now()) return new Response(null, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = (await req.json()) as { op: string } & Record<string, any>
  try {
    switch (b.op) {
      case "settings": return Response.json(await ops.runnerSettings())
      case "prepare": return Response.json(await ops.prepare(b.buildId))
      case "progress": return Response.json(await ops.progress(b.buildId, { status: b.status, reason: b.reason, commit: b.commit }))
      case "scan": return Response.json(await ops.scan(b.buildId, b.digest))
      case "tag": return Response.json(await ops.tag(b.buildId, b.digest))
      case "finish": return Response.json(await ops.finish(b.buildId, b as never))
      case "cosign-get": return Response.json(await ops.cosignGet())
      case "cosign-set": return Response.json(await ops.cosignSet(b as never) ?? {})
      case "schedule-info": return Response.json(await ops.scheduleInfo(b.ruleId))
      case "schedule-start": return Response.json(await ops.scheduleStart(b.ruleId, b.refs))
      case "recover": return Response.json(await ops.recover())
      default: return new Response(`No op called ${b.op}.`, { status: 400 })
    }
  } catch (e) {
    console.error(`[build-runner] ${b.op}:`, e)
    return new Response((e as Error).message, { status: 500 })
  }
}
