import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"
import { listVaults, vaultPolicy } from "@/lib/vault"

// My vaults, and whether I may make another (`why` says why not).
export const GET = () =>
  withMember(async (me) => {
    const [vaults, policy] = await Promise.all([listVaults(me.id), vaultPolicy()])
    const canCreate =
      policy.enabled && (policy.cap === null || vaults.length < policy.cap)
    return Response.json({
      vaults,
      canCreate,
      why: !policy.enabled
        ? "An admin turned off new vaults on this server."
        : canCreate
          ? null
          : `You have the most vaults allowed here (${policy.cap}).`,
    })
  })

// The app derives the keys from the passphrase (Argon2id) and sends them
// sealed; the server never sees the passphrase. Returns { id }.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        name: z.string(),
        salt: z.string(),
        wrapped: z.string(),
        recoveryWrapped: z.string(),
        kdf: z.object({ t: z.number(), m: z.number() }),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.createVault(me, b))
  })
