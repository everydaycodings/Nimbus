import { json } from "@/lib/api"
import { connSchema } from "@/lib/secrets/dyn-schemas"
import { projectRoute } from "@/lib/secrets/guard"
import { createConnection, listConnections, listLeases, listRotations, sessionLog } from "@/lib/secrets/dynamic"

// Viewers see the connections; leases are for developers and up, rotations for admins.
export const GET = projectRoute("viewer", async (c) =>
  Response.json({
    connections: await listConnections(c),
    leases: c.role === "viewer" ? [] : await listLeases(c),
    rotations: c.role === "admin" ? await listRotations(c) : [],
  })
)

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, connSchema)
  if (b instanceof Response) return b
  return Response.json(await createConnection(c, b, sessionLog))
})
