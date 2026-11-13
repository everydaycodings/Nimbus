import { limitIp } from "@/lib/api"
import { httpAnswer } from "@/lib/secrets/acme"

// HTTP-01 answers for orders in flight: public, plain text, nothing else is ever served here.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const limited = await limitIp("acme-http")
  if (limited) return limited
  const answer = await httpAnswer((await ctx.params).token)
  return answer ? new Response(answer, { headers: { "content-type": "text/plain" } }) : new Response("Not found", { status: 404 })
}
