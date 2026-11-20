import { agentConfig, agentReport } from "@/lib/server-backup/agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const token = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer /, "")
const reply = (r: { status: number; body: string }) => new Response(r.status === 204 ? null : r.body, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })

// The push agent asks for the job's settings (opens a run), then reports back. Authorised by the agent token alone.
export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return reply(await agentConfig(token(req), (await params).jobId))
}

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return reply(await agentReport(token(req), (await params).jobId, await req.formData()))
}
