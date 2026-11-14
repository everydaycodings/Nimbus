import { cliFail, cliGuard } from "@/lib/secrets/cli-api"
import { readBinary } from "@/lib/secrets/cli-files"
import { tokenPolicy } from "@/lib/secrets/tokens"

// A Go binary from packages/cli-go/dist, or the Node CLI (nimbus.mjs, nimbus-cli.tgz). Public (a server fetches it with curl), unless the CLI is off.
export const GET = (req: Request, ctx: { params: Promise<{ name: string }> }) =>
  cliGuard(req, async () => {
    if (!(await tokenPolicy()).cli) return cliFail(403, "forbidden", "An admin turned the CLI off.")
    const name = (await ctx.params).name
    const file = await readBinary(name)
    if (!file) return cliFail(404, "not_found", "That build isn't on this server.")
    return new Response(new Uint8Array(file), {
      headers: {
        "content-type": name.endsWith(".mjs") ? "text/javascript; charset=utf-8" : name.endsWith(".tgz") ? "application/gzip" : "application/octet-stream",
        "content-disposition": `attachment; filename="${name}"`,
      },
    })
  })
