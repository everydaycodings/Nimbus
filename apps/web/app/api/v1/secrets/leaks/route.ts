import { withSecrets } from "@/lib/secrets/guard"
import { leakScanEnabled, listLeaks } from "@/lib/secrets/leaks"

export const GET = (req: Request) =>
  withSecrets(async (me) => {
    const closed = new URL(req.url).searchParams.get("status") === "closed"
    return Response.json({ enabled: await leakScanEnabled(), leaks: await listLeaks(me.id, closed ? "closed" : "open") })
  })
