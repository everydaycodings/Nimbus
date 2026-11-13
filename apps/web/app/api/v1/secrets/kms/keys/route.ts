import { cliRoute } from "@/lib/secrets/cli-api"
import { kmsKeysFor } from "@/lib/secrets/kms-cli"

// CONTRACT.md: GET /kms/keys?project= lists key names (never material).
export const GET = (req: Request) =>
  cliRoute(req, (p) => kmsKeysFor(p, new URL(req.url).searchParams.get("project")))
