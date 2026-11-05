import { notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Where to fetch a vault file's ciphertext, and its wrapped file key.
export const GET = (
  _: Request,
  { params }: { params: Promise<{ id: string; nodeId: string }> }
) =>
  withMember(async (me) => {
    const { id, nodeId } = await params
    const f = await svc.vaultFileUrl(me, id, nodeId)
    return f ? Response.json(f) : notFound("That file")
  })
