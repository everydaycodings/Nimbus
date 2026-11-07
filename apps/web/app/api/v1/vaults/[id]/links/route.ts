import { z } from "zod"

import { done, json, notFound, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

type Ctx = { params: Promise<{ id: string }> }

// My share links for this vault. Labels are sealed with the vault key.
export const GET = (_: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const links = await svc.listVaultLinks(me, (await params).id)
    return links ? Response.json({ links }) : notFound("That vault")
  })

// The app re-wraps each file's key under a fresh link key and seals the manifest;
// see packages/shared/vault-crypto.ts. The link is `<server>/v/<token>#<key>`,
// or without the #key in passphrase mode. Returns { id, token }.
export const POST = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        manifest: z.string().max(2 * 1024 * 1024),
        label: z.string().max(4096),
        versionIds: z.array(z.string()).max(5000),
        expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).nullable(),
        passphrase: z
          .object({
            salt: z.string(),
            kdf: z.object({ t: z.number(), m: z.number() }),
            wrapped: z.string(),
          })
          .optional(),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.createVaultLink(me, (await params).id, b))
  })
