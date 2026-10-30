"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { reloadAuth } from "@/lib/auth"
import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { account, settings, user } from "@/lib/db/schema"
import { OIDC_ID, discoveryUrl, getOidcConfig } from "@/lib/oidc"
import { requireAdmin } from "@/lib/session"

export type OidcFormState = { ok?: boolean; error?: string } | null

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim()

// http only for local test servers; anything else must be https.
function issuerOf(raw: string) {
  try {
    const u = new URL(raw)
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
    if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
      return null
    return u.toString().replace(/\/+$/, "")
  } catch {
    return null
  }
}

// Blank issuer turns it off. Blank secret keeps what's stored. Applies on the
// next request: the auth instance is rebuilt.
export async function saveOidc(
  _: OidcFormState,
  form: FormData
): Promise<OidcFormState> {
  await requireAdmin()
  const c = await getOidcConfig()
  if (c.source === "env")
    return { error: "OIDC is set in env, so it can't be changed here." }

  const raw = field(form, "issuer")
  if (!raw) {
    await db
      .update(settings)
      .set({ oidcIssuer: null, oidcOnly: false, updatedAt: new Date() })
    reloadAuth()
    revalidatePath("/", "layout")
    return { ok: true }
  }
  const issuer = issuerOf(raw)
  if (!issuer) return { error: "Enter the issuer as an https:// URL." }
  const clientId = field(form, "clientId")
  if (!clientId) return { error: "Enter the client ID." }
  const secret = String(form.get("clientSecret") ?? "")
  if (!secret && (!c.clientSecret || c.sealedSecretLost))
    return { error: "Enter the client secret." }

  // The owner's way back in while everyone else must use the provider.
  const only = form.get("only") === "on"
  if (only) {
    const [ok] = await db
      .select({ id: account.id })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(
        and(
          eq(user.role, "owner"),
          inArray(account.providerId, ["credential", OIDC_ID])
        )
      )
      .limit(1)
    if (!ok)
      return {
        error:
          "The owner needs a password or a connected OIDC sign-in before OIDC can be the only way in.",
      }
  }

  await db.update(settings).set({
    oidcName: field(form, "name").slice(0, 40) || null,
    oidcIssuer: issuer,
    oidcClientId: clientId,
    ...(secret && { oidcClientSecret: encrypt(secret) }),
    oidcOnly: only,
    updatedAt: new Date(),
  })
  reloadAuth()
  revalidatePath("/", "layout")
  return { ok: true }
}

export type OidcTestState = { issuer?: string; error?: string } | null

// Fetches the discovery document for the issuer typed in the form.
export async function testOidc(
  _: OidcTestState,
  form: FormData
): Promise<OidcTestState> {
  await requireAdmin()
  const c = await getOidcConfig()
  const issuer = c.source === "env" ? c.issuer : issuerOf(field(form, "issuer"))
  if (!issuer) return { error: "Enter the issuer as an https:// URL." }
  try {
    const res = await fetch(discoveryUrl(issuer), {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
    if (!res.ok) return { error: `The issuer answered ${res.status}.` }
    const doc = (await res.json()) as {
      issuer?: string
      authorization_endpoint?: string
      token_endpoint?: string
    }
    if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint)
      return { error: "That isn't an OpenID Connect discovery document." }
    return { issuer: doc.issuer }
  } catch (e) {
    return {
      error: `Couldn't reach it: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
