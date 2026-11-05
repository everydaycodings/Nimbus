import { notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// The whole vault in one go (names are sealed; the app decrypts them and
// builds the tree). Trashed items are included, with trashedAt set.
export const GET = (
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const nodes = await svc.vaultTree(me, (await params).id)
    return nodes ? Response.json({ nodes }) : notFound("That vault")
  })
