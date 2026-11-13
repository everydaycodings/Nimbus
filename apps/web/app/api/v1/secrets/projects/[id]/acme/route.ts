import { customAllowed, listAccounts, listDnsCreds, listOrders } from "@/lib/secrets/acme"
import { projectRoute } from "@/lib/secrets/guard"

export const GET = projectRoute("viewer", async (c) =>
  Response.json({ accounts: await listAccounts(c), creds: await listDnsCreds(c), orders: await listOrders(c), customAllowed: customAllowed() })
)
