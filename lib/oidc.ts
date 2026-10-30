// One OpenID Connect provider (Authentik, Keycloak, …). Relative imports:
// lib/auth.ts imports this and the Better Auth CLI can't resolve `@/`.
import { decrypt } from "./crypto"
import { getSettings } from "./signup"

export type OidcConfig = {
  // "env" means OIDC_ISSUER is set, so the admin panel shows it read-only.
  source: "env" | "db"
  // The button says "Sign in with <name>".
  name: string
  issuer: string
  clientId: string
  clientSecret: string
  // Only OIDC sign-in, except the owner's password.
  only: boolean
  // The stored secret couldn't be decrypted, usually because BETTER_AUTH_SECRET changed.
  sealedSecretLost: boolean
}

// Better Auth serves it at /api/auth/callback/oidc.
export const OIDC_ID = "oidc"

export async function getOidcConfig(): Promise<OidcConfig> {
  const env = process.env
  if (env.OIDC_ISSUER)
    return {
      source: "env",
      name: env.OIDC_NAME || "SSO",
      issuer: env.OIDC_ISSUER,
      clientId: env.OIDC_CLIENT_ID ?? "",
      clientSecret: env.OIDC_CLIENT_SECRET ?? "",
      only: env.OIDC_ONLY === "true",
      sealedSecretLost: false,
    }
  const s = await getSettings()
  const secret = s.oidcClientSecret ? decrypt(s.oidcClientSecret) : ""
  return {
    source: "db",
    name: s.oidcName || "SSO",
    issuer: s.oidcIssuer ?? "",
    clientId: s.oidcClientId ?? "",
    clientSecret: secret ?? "",
    only: s.oidcOnly,
    sealedSecretLost: secret === null,
  }
}

export const oidcReady = (c: OidcConfig) =>
  Boolean(c.issuer && c.clientId && c.clientSecret)

// "OIDC only" counts only once the provider can actually sign people in.
export const oidcOnly = (c: OidcConfig) => c.only && oidcReady(c)

export const discoveryUrl = (issuer: string) =>
  `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`
