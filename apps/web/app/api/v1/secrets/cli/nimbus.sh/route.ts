import { cliFail, cliGuard } from "@/lib/secrets/cli-api"
import { readScript } from "@/lib/secrets/cli-files"
import { tokenPolicy } from "@/lib/secrets/tokens"

// curl -fsSL <server>/api/v1/secrets/cli/nimbus.sh | bash -s -- run --env dev -- cmd
export const GET = (req: Request) =>
  cliGuard(req, async () => {
    if (!(await tokenPolicy()).cli) return cliFail(403, "forbidden", "An admin turned the CLI off.")
    const file = await readScript()
    if (!file) return cliFail(404, "not_found", "The script isn't on this server.")
    return new Response(new Uint8Array(file), { headers: { "content-type": "text/x-shellscript; charset=utf-8" } })
  })
