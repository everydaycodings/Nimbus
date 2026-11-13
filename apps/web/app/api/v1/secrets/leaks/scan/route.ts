import { withSecrets } from "@/lib/secrets/guard"
import { leakScanEnabled } from "@/lib/secrets/leaks"
import { enqueue } from "@/lib/redis"

// "Scan my files": the worker does the reading and sends a bell notice when it's done.
export const POST = () =>
  withSecrets(async (me) => {
    if (!(await leakScanEnabled())) return Response.json({ error: "disabled", message: "An admin turned file scanning off." }, { status: 409 })
    await enqueue("leak-scan-user", { userId: me.id })
    return Response.json({ queued: true })
  })
