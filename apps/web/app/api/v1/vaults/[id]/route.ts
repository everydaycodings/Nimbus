import { done, notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"
import { getVault } from "@/lib/vault"

type Ctx = { params: Promise<{ id: string }> }

// The vault's sealed keys: the app unlocks them with the passphrase.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const v = await getVault(me.id, (await params).id)
    if (!v) return notFound("That vault")
    return Response.json({
      id: v.id,
      name: v.name,
      salt: v.salt,
      wrapped: v.wrappedKey,
      recoveryWrapped: v.recoveryWrappedKey,
      kdf: { t: v.kdfIterations, m: v.kdfMemory },
    })
  })

// Deletes the vault and everything in it. The app checks the passphrase and
// the typed name first; the server can't.
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) => done(await svc.deleteVault(me, (await params).id)))
