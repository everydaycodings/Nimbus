import { createHmac, randomBytes } from "node:crypto"

import type { GenericEndpointContext } from "@better-auth/core"
import { expo } from "@better-auth/expo"
import { passkey } from "@better-auth/passkey"
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import { betterAuth } from "better-auth"
import * as z from "zod"
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import {
  bearer,
  genericOAuth,
  multiSession,
  twoFactor,
} from "better-auth/plugins"
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth"
import { and, count, eq, inArray } from "drizzle-orm"

import {
  ADDING_COOKIE,
  KNOWN_COOKIE,
  KNOWN_COOKIE_OPTIONS,
  MAX_SESSIONS,
  parseKnown,
} from "./accounts"
import { randomPreset } from "./avatars"
import {
  OFFER_SAVE_COOKIE,
  SAVED_MAX_AGE,
  SAVED_PREFIX,
} from "./saved-login-rules"
import { redeemSession, stashSession } from "./app-return"
import { claimLink, collectLink, pollLink } from "./device-link"
import { savedOnBrowser, touchSavedLogin } from "./saved-logins"
import { db } from "./db"
import * as schema from "./db/schema"
import { message, sendInBackground } from "./email"
import {
  OIDC_ID,
  discoveryUrl,
  getOidcConfig,
  oidcOnly,
  oidcReady,
  type OidcConfig,
} from "./oidc"
import { DEBUG_SHA256, apkOrigin, passkeyHost } from "./passkey-rules"
import { POLICY_MAX, POLICY_MIN, passwordProblem } from "./password-policy"
import {
  INVITE_COOKIE,
  SHARE_INVITE_COOKIE,
  bindShareInvites,
  claimInvite,
  getSettings,
  isTrustedEmail,
  readShareInvite,
} from "./signup"
import { ipFrom } from "@/lib/client-ip"

// A provider is offered only when both of its keys are set.
function provider(id: "GOOGLE" | "GITHUB") {
  const clientId = process.env[`${id}_CLIENT_ID`]
  const clientSecret = process.env[`${id}_CLIENT_SECRET`]
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

const google = provider("GOOGLE")
const github = provider("GITHUB")

// What the sign-in and sign-up forms offer.
export async function enabledProviders() {
  const oidc = await getOidcConfig()
  return {
    google: Boolean(google),
    github: Boolean(github),
    oidc: oidcReady(oidc) ? { name: oidc.name } : null,
    only: oidcOnly(oidc),
  }
}

const isOwnerEmail = async (email: unknown) =>
  typeof email === "string" &&
  (
    await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        and(
          eq(schema.user.email, email.trim().toLowerCase()),
          eq(schema.user.role, "owner")
        )
      )
  ).length > 0

const onlyOidcError = (c: OidcConfig) =>
  new APIError("FORBIDDEN", {
    message: `This Nimbus signs in with ${c.name} only.`,
  })

// Remembers who signed in on this browser for the account menu, and logs an
// account added on top of another. Listed after twoFactor, whose hook clears
// newSession while a sign-in still waits for its code.
const requestIp = (h: Headers | undefined) =>
  ipFrom(h)

async function logEvent(
  h: Headers | undefined,
  userId: string,
  kind: schema.AuthEventKind
) {
  await db.insert(schema.authEvents).values({
    userId,
    kind,
    ip: requestIp(h),
    ua: h?.get("user-agent") ?? null,
  })
}

// Sign-ins that ask "Save your login info?" afterwards: not switching or a saved login.
const FRESH_SIGN_IN =
  /^\/(sign-in\/email|sign-up\/email|two-factor\/verify-(totp|backup-code|passkey)|passkey\/verify-authentication|callback\/)/

// The two-factor step a sign-in waits at: a signed cookie naming a short-lived
// verification row, which a code, a backup code or a passkey turns into a
// session. Mirrors the two-factor plugin after a password sign-in. Returns the
// cookie as "name=value", for the app, which carries it by hand.
type SignedCookieCtx = Pick<GenericEndpointContext, "context" | "setSignedCookie">

async function startTwoFactor(ctx: SignedCookieCtx, userId: string) {
  const maxAge = 600
  const cookie = ctx.context.createAuthCookie("two_factor", { maxAge })
  const identifier = `2fa-${randomBytes(15).toString("hex")}`
  const expiresAt = new Date(Date.now() + maxAge * 1000)
  await ctx.context.internalAdapter.createVerificationValue({
    value: userId,
    identifier,
    expiresAt,
  })
  await ctx.context.internalAdapter.createVerificationValue({
    value: "0",
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  })
  const set = await ctx.setSignedCookie(
    cookie.name,
    identifier,
    ctx.context.secret,
    cookie.attributes
  )
  return set.split(";")[0]
}

// "Don't ask again on this device": the two-factor plugin's trust_device cookie,
// an HMAC over the user and a verification row the server can revoke.
const TRUST_MAX_AGE = 30 * 24 * 60 * 60
const trustToken = (secret: string, userId: string, id: string) =>
  createHmac("sha256", secret).update(`${userId}!${id}`).digest("base64url")

async function trustedDevice(ctx: GenericEndpointContext, userId: string) {
  const cookie = ctx.context.createAuthCookie("trust_device")
  const [token, id] = (
    (await ctx.getSignedCookie(cookie.name, ctx.context.secret)) || ""
  ).split("!")
  if (!token || !id || token !== trustToken(ctx.context.secret, userId, id))
    return false
  const row = await ctx.context.internalAdapter.findVerificationValue(id)
  return Boolean(row && row.value === userId && row.expiresAt > new Date())
}

async function trustDevice(ctx: GenericEndpointContext, userId: string) {
  const cookie = ctx.context.createAuthCookie("trust_device", {
    maxAge: TRUST_MAX_AGE,
  })
  const id = `trust-device-${randomBytes(24).toString("hex")}`
  await ctx.context.internalAdapter.createVerificationValue({
    value: userId,
    identifier: id,
    expiresAt: new Date(Date.now() + TRUST_MAX_AGE * 1000),
  })
  await ctx.setSignedCookie(
    cookie.name,
    `${trustToken(ctx.context.secret, userId, id)}!${id}`,
    ctx.context.secret,
    cookie.attributes
  )
}

// Passkeys work on https with a domain name (or localhost), when the admin
// leaves them on. The web origin and the Android app's signing certificates
// (release from env, plus the debug one) may all sign in.
export const passkeyOrigins = () => [
  new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin,
  ...[process.env.ANDROID_RELEASE_SHA256, DEBUG_SHA256].flatMap(
    (f) => apkOrigin(f) ?? []
  ),
]

export async function passkeyStatus() {
  const host = passkeyHost(process.env.BETTER_AUTH_URL)
  const [row] = await db
    .select({ on: schema.settings.passkeysEnabled })
    .from(schema.settings)
  const on = row?.on ?? true
  return {
    available: Boolean(host) && on,
    reason: !host
      ? "Passkeys need HTTPS and a domain name."
      : on
        ? null
        : "Your admin turned passkeys off.",
  }
}

// The user whose two-factor step this request is at, from the signed cookie.
async function pendingTwoFactor(ctx: GenericEndpointContext) {
  const cookie = ctx.context.createAuthCookie("two_factor")
  const identifier = await ctx.getSignedCookie(
    cookie.name,
    ctx.context.secret
  )
  const row = identifier
    ? await ctx.context.internalAdapter.findVerificationValue(identifier)
    : null
  if (!identifier || !row || row.expiresAt < new Date())
    throw new APIError("UNAUTHORIZED", {
      message: "This sign-in timed out. Sign in again.",
      code: "INVALID_TWO_FACTOR_COOKIE",
    })
  return { identifier, userId: row.value, cookie }
}

// Provider sign-ins (Google, GitHub, OIDC) skip the two-factor plugin, whose
// hook only matches password paths. This asks for the second step after them
// too. It must sit right after twoFactor() in the plugin list: multiSession's
// and the accounts hooks below then see no session for it and leave it alone.
// OIDC can be exempt when the provider asks for its own MFA.
const providerTwoFactor = {
  id: "nimbus-provider-2fa",
  hooks: {
    after: [
      {
        matcher: (ctx) => ctx.path?.startsWith("/callback/") === true,
        handler: createAuthMiddleware(async (ctx) => {
          const s = ctx.context.newSession
          if (!s?.user.twoFactorEnabled) return
          if (
            ctx.params?.id === OIDC_ID &&
            (await getSettings()).oidcTrustMfa
          )
            return
          if (await trustedDevice(ctx, s.user.id)) return
          // The session the callback just made is not allowed yet.
          await ctx.context.internalAdapter.deleteSession(s.session.token)
          ctx.context.setNewSession(null)
          const headers = ctx.context.responseHeaders
          headers?.delete("set-cookie")
          const pending = await startTwoFactor(ctx, s.user.id)
          const location = headers?.get("location") ?? "/"
          if (location.startsWith("nimbus://")) {
            // The app trades this code for the cookie, then opens its code screen.
            const url = new URL(location)
            url.searchParams.delete("cookie")
            url.searchParams.set("code", await stashSession(pending))
            url.searchParams.set("twofa", "1")
            ctx.setHeader("location", url.toString())
            return
          }
          const base = new URL(ctx.context.baseURL)
          const to = new URL(location, base)
          const next = to.origin === base.origin ? to.pathname + to.search : "/"
          ctx.setHeader("location", `/two-factor?next=${encodeURIComponent(next)}`)
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin

// A passkey as the second step, for a sign-in waiting at /two-factor. Only
// built with the passkey plugin, whose table it reads.
const passkeyTwoFactor = (rpID: string, origins: string[]) =>
  ({
    id: "nimbus-passkey-2fa",
    endpoints: {
      passkeyTwoFactorOptions: createAuthEndpoint(
        "/two-factor/passkey-options",
        { method: "POST" },
        async (ctx) => {
          const { identifier, userId } = await pendingTwoFactor(ctx)
          const keys = await ctx.context.adapter.findMany<{
            credentialID: string
            transports: string | null
          }>({ model: "passkey", where: [{ field: "userId", value: userId }] })
          if (!keys.length)
            throw new APIError("BAD_REQUEST", {
              message: "This account has no passkey.",
              code: "NO_PASSKEY",
            })
          const options = await generateAuthenticationOptions({
            rpID,
            userVerification: "preferred",
            allowCredentials: keys.map((k) => ({
              id: k.credentialID,
              transports: k.transports?.split(",").filter(Boolean) as
                | undefined
                | AuthenticatorTransport[],
            })),
          })
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `2fa-passkey-${identifier}`,
            value: options.challenge,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          })
          return ctx.json(options)
        }
      ),
      passkeyTwoFactorVerify: createAuthEndpoint(
        "/two-factor/verify-passkey",
        {
          method: "POST",
          body: z.object({
            response: z.record(z.string(), z.any()),
            trustDevice: z.boolean().optional(),
          }),
        },
        async (ctx) => {
          const { identifier, userId, cookie } = await pendingTwoFactor(ctx)
          const bad = () =>
            new APIError("UNAUTHORIZED", {
              message: "That passkey didn't work. Try again.",
              code: "INVALID_PASSKEY",
            })
          // One try per challenge.
          const challenge =
            await ctx.context.internalAdapter.consumeVerificationValue(
              `2fa-passkey-${identifier}`
            )
          const resp = ctx.body.response
          const key = await ctx.context.adapter.findOne<{
            id: string
            credentialID: string
            publicKey: string
            counter: number
            transports: string | null
          }>({
            model: "passkey",
            where: [
              { field: "credentialID", value: String(resp.id) },
              { field: "userId", value: userId },
            ],
          })
          if (!challenge || !key) throw bad()
          let counter: number
          try {
            const v = await verifyAuthenticationResponse({
              response: resp as never,
              expectedChallenge: challenge.value,
              expectedOrigin: origins,
              expectedRPID: rpID,
              credential: {
                id: key.credentialID,
                publicKey: Buffer.from(key.publicKey, "base64"),
                counter: key.counter,
                transports: key.transports?.split(",").filter(Boolean) as
                  | undefined
                  | AuthenticatorTransport[],
              },
              requireUserVerification: false,
            })
            if (!v.verified) throw bad()
            counter = v.authenticationInfo.newCounter
          } catch {
            throw bad()
          }
          await ctx.context.adapter.update({
            model: "passkey",
            where: [{ field: "id", value: key.id }],
            update: { counter },
          })
          // Single use: the step is spent whatever happens next.
          if (!(await ctx.context.internalAdapter.consumeVerificationValue(identifier)))
            throw bad()
          const user = await ctx.context.internalAdapter.findUserById(userId)
          const session = await ctx.context.internalAdapter.createSession(userId)
          if (!user || !session)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Couldn't sign you in. Try again.",
            })
          await setSessionCookie(ctx, { session, user })
          ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 })
          if (ctx.body.trustDevice) await trustDevice(ctx, userId)
          return ctx.json({ token: session.token })
        }
      ),
    },
  }) satisfies BetterAuthPlugin

const accountMemory = {
  id: "nimbus-accounts",
  // Plugin rules so these public endpoints are limited per IP, like sign-in.
  rateLimit: [
    {
      pathMatcher: (path: string) => path === "/device-link/claim",
      window: 60,
      max: 10,
    },
    {
      pathMatcher: (path: string) => path === "/device-link/poll",
      window: 60,
      max: 60,
    },
    {
      pathMatcher: (path: string) => path === "/app-return/exchange",
      window: 60,
      max: 20,
    },
  ],
  endpoints: {
    // A device presents a QR token or short code from someone's Account page.
    claimDeviceLink: createAuthEndpoint(
      "/device-link/claim",
      {
        method: "POST",
        body: z.object({
          token: z.string().max(100).optional(),
          code: z.string().max(20).optional(),
          deviceName: z.string().trim().min(1).max(80),
        }),
      },
      async (ctx) => {
        const { deviceLinks } = await getSettings()
        if (!deviceLinks)
          throw new APIError("FORBIDDEN", {
            message: "This Nimbus doesn't allow signing in with a code.",
          })
        const { token, code, deviceName } = ctx.body
        const pollSecret = await claimLink(
          { token, code },
          deviceName,
          requestIp(ctx.headers)
        )
        if (!pollSecret)
          throw new APIError("BAD_REQUEST", {
            message:
              "That code didn't work. It may have expired or been used. Get a new one from your Account page.",
          })
        return ctx.json({ pollSecret })
      }
    ),
    pollDeviceLink: createAuthEndpoint(
      "/device-link/poll",
      {
        method: "POST",
        body: z.object({ pollSecret: z.string().max(100) }),
      },
      async (ctx) => ctx.json({ status: await pollLink(ctx.body.pollSecret) })
    ),
    // Approved in the browser: start this device's own session. The bearer
    // plugin returns its token, and it appears in the account's sessions.
    finishDeviceLink: createAuthEndpoint(
      "/device-link/finish",
      {
        method: "POST",
        body: z.object({ pollSecret: z.string().max(100) }),
      },
      async (ctx) => {
        const userId = await collectLink(ctx.body.pollSecret)
        const user = userId
          ? await ctx.context.internalAdapter.findUserById(userId)
          : null
        const session = user
          ? await ctx.context.internalAdapter.createSession(user.id)
          : null
        if (!user || !session)
          throw new APIError("BAD_REQUEST", {
            message: "That sign-in has expired. Get a new code and try again.",
          })
        await setSessionCookie(ctx, { session, user })
        await logEvent(ctx.headers, user.id, "device_linked")
        return ctx.json({ ok: true })
      }
    ),
    // The Expo plugin's /expo-authorization-proxy, which only takes https. This
    // twin also takes the configured OIDC issuer over plain http (LAN identity
    // providers), and nothing else over http. The app uses it only for http.
    appAuthorize: createAuthEndpoint(
      "/app-authorize",
      {
        method: "GET",
        query: z.object({
          authorizationURL: z.string(),
          oauthState: z.string().optional(),
        }),
      },
      async (ctx) => {
        const { authorizationURL, oauthState } = ctx.query
        const bad = () =>
          new APIError("BAD_REQUEST", { message: "Invalid authorizationURL" })
        let url: URL
        try {
          url = new URL(authorizationURL)
        } catch {
          throw bad()
        }
        const oidc = await getOidcConfig()
        const issuer = oidcReady(oidc) ? new URL(oidc.issuer).origin : null
        const allowed =
          url.protocol === "https:" ||
          (url.protocol === "http:" && url.origin === issuer)
        if (
          authorizationURL.includes("#") ||
          !allowed ||
          url.origin === new URL(ctx.context.baseURL).origin
        )
          throw bad()
        if (oauthState) {
          const c = ctx.context.createAuthCookie("oauth_state", { maxAge: 600 })
          ctx.setCookie(c.name, oauthState, c.attributes)
          return ctx.redirect(authorizationURL)
        }
        const state = url.searchParams.get("state")
        if (!state) throw bad()
        const c = ctx.context.createAuthCookie("state", { maxAge: 300 })
        await ctx.setSignedCookie(c.name, state, ctx.context.secret, c.attributes)
        return ctx.redirect(authorizationURL)
      }
    ),
    // The app trades the one-time code from its OAuth return for the session
    // token (see after-hooks below). The bearer plugin takes it as before.
    exchangeAppReturn: createAuthEndpoint(
      "/app-return/exchange",
      { method: "POST", body: z.object({ code: z.string().max(100) }) },
      async (ctx) => {
        const token = await redeemSession(ctx.body.code)
        if (!token)
          throw new APIError("BAD_REQUEST", {
            message: "That sign-in didn't finish. Try again.",
          })
        return ctx.json({ token })
      }
    ),
    // One tap on a saved login (sign-in page). The secret never leaves its
    // httpOnly cookie. Two-factor accounts still go through /two-factor.
    signInSaved: createAuthEndpoint(
      "/saved-login/use",
      { method: "POST", body: z.object({ id: z.uuid() }) },
      async (ctx) => {
        const { id } = ctx.body
        const name = SAVED_PREFIX + id
        const secret = ctx.getCookie(name) ?? ""
        const [saved] = await savedOnBrowser([{ name, value: secret }])
        if (!saved) {
          ctx.setCookie(name, "", { path: "/", maxAge: 0 })
          throw new APIError("UNAUTHORIZED", {
            message:
              "This saved login doesn't work anymore. Sign in with your password.",
          })
        }
        const oidc = await getOidcConfig()
        if (oidcOnly(oidc)) {
          const [u] = await db
            .select({ role: schema.user.role })
            .from(schema.user)
            .where(eq(schema.user.id, saved.userId))
          if (u?.role !== "owner") throw onlyOidcError(oidc)
        }
        await touchSavedLogin(id)
        ctx.setCookie(name, secret, {
          ...KNOWN_COOKIE_OPTIONS,
          maxAge: SAVED_MAX_AGE,
        })
        await logEvent(ctx.headers, saved.userId, "saved_login_used")

        if (saved.twoFactorEnabled) {
          await startTwoFactor(ctx, saved.userId)
          return ctx.json({ twoFactorRedirect: true })
        }

        const user = await ctx.context.internalAdapter.findUserById(
          saved.userId
        )
        const session = await ctx.context.internalAdapter.createSession(
          saved.userId
        )
        if (!user || !session)
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Couldn't sign you in. Try your password.",
          })
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ twoFactorRedirect: false })
      }
    ),
    // Sessions from before multi-session was on have no multi-session cookie.
    // Setting the session cookie again lets the plugin add one, so the current
    // account survives another signing in on top (app/(app)/actions.ts).
    keepCurrentSession: createAuthEndpoint(
      "/accounts/keep-current",
      { method: "POST", use: [sessionMiddleware] },
      async (ctx) => {
        await setSessionCookie(ctx, ctx.context.session)
        return ctx.json({ ok: true })
      }
    ),
  },
  hooks: {
    after: [
      {
        matcher: () => true,
        handler: createAuthMiddleware(async (ctx) => {
          const s = ctx.context.newSession
          if (!s) return
          const me = {
            id: s.user.id,
            name: s.user.name,
            email: s.user.email,
            image: s.user.image ?? null,
          }
          const known = parseKnown(ctx.getCookie(KNOWN_COOKIE) ?? undefined)
          const at = known.findIndex((k) => k.id === me.id)
          if (at < 0) known.push(me)
          else known[at] = me
          ctx.setCookie(
            KNOWN_COOKIE,
            JSON.stringify(known.slice(-MAX_SESSIONS)),
            KNOWN_COOKIE_OPTIONS
          )
          if (FRESH_SIGN_IN.test(ctx.path))
            ctx.setCookie(OFFER_SAVE_COOKIE, me.id, {
              ...KNOWN_COOKIE_OPTIONS,
              maxAge: 10 * 60,
            })
          if (!ctx.getCookie(ADDING_COOKIE)) return
          ctx.setCookie(ADDING_COOKIE, "", { path: "/", maxAge: 0 })
          await logEvent(ctx.headers, me.id, "added")
        }),
      },
      // A provider sign-in that returns to the app (nimbus://): swap the session
      // cookie for a one-time code, and keep cookies out of the deep link. Runs
      // after the hook above and before the Expo plugin's, which then finds no cookie to append.
      {
        matcher: (ctx) => ctx.path?.startsWith("/callback/") === true,
        handler: createAuthMiddleware(async (ctx) => {
          const headers = ctx.context.responseHeaders
          const location = headers?.get("location")
          if (!headers || !location?.startsWith("nimbus://")) return
          const name = ctx.context.authCookies.sessionToken.name
          const line = headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
          const value = line?.slice(name.length + 1).split(";")[0]
          headers.delete("set-cookie")
          const url = new URL(location)
          url.searchParams.delete("cookie")
          if (value)
            url.searchParams.set(
              "code",
              await stashSession(decodeURIComponent(value))
            )
          ctx.setHeader("location", url.toString())
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin

// Everything but the OIDC provider, which build() adds.
const options = {
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // The Android app's scheme, for its OAuth return and the origin it sends.
  trustedOrigins: ["nimbus://"],
  // Sign-in rate limits key on the IP nginx saw ($remote_addr), not the client-set
  // first X-Forwarded-For entry (better-auth's default).
  advanced: { ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
  emailAndPassword: {
    enabled: true,
    // The floor an owner can choose; the before-hook applies their actual policy.
    minPasswordLength: POLICY_MIN,
    maxPasswordLength: POLICY_MAX,
    revokeSessionsOnPasswordReset: true,
    // Every auth email goes out in the background and is skipped when email isn't
    // set up; the sign-in page hides "Forgot password?" in that case.
    sendResetPassword: async ({ user, url }) =>
      sendInBackground(
        message({
          to: user.email,
          subject: "Reset your Nimbus password",
          lines: [
            `Someone asked to reset the password for ${user.email}. If it was you, choose a new one below. The link works for one hour.`,
          ],
          action: { label: "Choose a new password", url },
          footer:
            "Didn't ask for this? Ignore this email; your password stays the same.",
        })
      ),
  },
  // Verification is enforced in the app layout, not here, because it only applies
  // while email is set up and only to accounts without two-factor.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) =>
      sendInBackground(
        message({
          to: user.email,
          subject: "Confirm your email for Nimbus",
          lines: [
            `Confirm that ${user.email} is your address to finish setting up your Nimbus account. The link works for one hour.`,
          ],
          action: { label: "Confirm email", url },
          footer: "Didn't create an account? Ignore this email.",
        })
      ),
    // A newly verified email on a trusted domain skips the approval queue.
    afterEmailVerification: async (verified) => {
      const { signupMode, trustedDomains } = await getSettings()
      if (
        signupMode === "closed" ||
        !isTrustedEmail(verified.email, trustedDomains)
      )
        return
      await db
        .update(schema.user)
        .set({ status: "active" })
        .where(
          and(
            eq(schema.user.id, verified.id),
            eq(schema.user.status, "pending")
          )
        )
    },
  },
  socialProviders: {
    ...(google && { google }),
    ...(github && { github }),
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "pending", input: false },
      passwordTemporary: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
      providerImage: { type: "string", required: false, input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // The first account owns the instance. After that the admin-chosen sign-up
        // mode decides; a trusted domain or an invite link skips approval. This hook
        // is the only gate, so email and OAuth sign-ups are both covered.
        // The one-owner unique index rejects a second owner if two sign-ups race.
        before: async (created, ctx) => {
          // Start with the provider's photo, or a random preset avatar.
          const user = {
            ...created,
            providerImage: created.image || null,
            image: created.image || randomPreset(),
          }
          const [{ n }] = await db.select({ n: count() }).from(schema.user)
          if (n === 0)
            return { data: { ...user, role: "owner", status: "active" } }

          const { signupMode, trustedDomains } = await getSettings()
          if (signupMode === "closed")
            throw new APIError("FORBIDDEN", {
              message: "Sign-ups are closed on this Nimbus.",
            })

          // The admin's own identity provider vouches for them: no approval or invite.
          if (ctx?.path.startsWith("/callback/") && ctx.params?.id === OIDC_ID)
            return { data: { ...user, role: "member", status: "active" } }

          // Only provider-verified emails count; password emails aren't verified yet.
          const trusted =
            user.emailVerified && isTrustedEmail(user.email, trustedDomains)
          const token = ctx?.getCookie(INVITE_COOKIE)
          // Someone shared files with this exact address and they opened the email.
          const shareEmail = await readShareInvite(
            ctx?.getCookie(SHARE_INVITE_COOKIE)
          )
          const invited =
            !trusted &&
            signupMode !== "open" &&
            (shareEmail?.toLowerCase() === user.email.toLowerCase() ||
              Boolean(token && (await claimInvite(token))))

          if (signupMode === "invite" && !trusted && !invited)
            throw new APIError("FORBIDDEN", {
              message: "You need an invite link to join this Nimbus.",
            })

          const active = signupMode === "open" || trusted || invited
          return {
            data: {
              ...user,
              role: "member",
              status: active ? "active" : "pending",
            },
          }
        },
        // Bind the shares they were invited to, and tell the admins if
        // someone is waiting.
        after: async (created, ctx) => {
          const shareEmail = await readShareInvite(
            ctx?.getCookie(SHARE_INVITE_COOKIE)
          )
          if (shareEmail?.toLowerCase() === created.email.toLowerCase()) {
            const bound = await bindShareInvites(created.id, created.email)
            // Dynamic: the Better Auth CLI can't load `@/` or server-only modules.
            const { notify } = await import("./notify")
            for (const b of bound)
              await notify(created.id, "shared", {
                nodeId: b.nodeId,
                actorId: b.createdBy,
                data: { role: b.role },
              })
          }
          if ((created as { status?: string }).status !== "pending") return
          const admins = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(
              and(
                inArray(schema.user.role, ["owner", "admin"]),
                eq(schema.user.status, "active")
              )
            )
          const { notify } = await import("./notify")
          for (const { id } of admins)
            await notify(id, "signup_request", {
              actorId: created.id,
              data: { who: `${created.name} (${created.email})` },
            })
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Every way a password gets chosen: sign-up, reset link, and change.
      const fresh =
        ctx.path === "/sign-up/email"
          ? ctx.body?.password
          : ctx.path === "/reset-password" || ctx.path === "/change-password"
            ? ctx.body?.newPassword
            : undefined
      if (typeof fresh === "string") {
        const problem = passwordProblem(
          fresh,
          (await getSettings()).passwordPolicy
        )
        if (problem) throw new APIError("BAD_REQUEST", { message: problem })
      }
      // The UI hides "Turn off" when an admin requires two-factor; this covers direct calls.
      if (
        ctx.path === "/two-factor/disable" &&
        (await getSettings()).require2fa
      )
        throw new APIError("FORBIDDEN", {
          message: "Your admin requires two-factor on this Nimbus.",
        })
      // OIDC only: the owner keeps their password, everyone else uses the provider.
      if (
        /^\/(sign-up\/email|sign-in\/email|sign-in\/social)$/.test(ctx.path)
      ) {
        const oidc = await getOidcConfig()
        if (
          oidcOnly(oidc) &&
          !(ctx.path === "/sign-in/social" && ctx.body?.provider === OIDC_ID) &&
          !(
            ctx.path === "/sign-in/email" &&
            (await isOwnerEmail(ctx.body?.email))
          )
        )
          throw onlyOidcError(oidc)
      }
    }),
  },
  plugins: [
    twoFactor({ issuer: "Nimbus" }),
    providerTwoFactor,
    // The admin's lower limit is checked before adding (app/(app)/actions.ts).
    multiSession({ maximumSessions: MAX_SESSIONS }),
    accountMemory,
    // The Android app signs in with these: a deep link back from OAuth, then a
    // signed bearer token instead of cookies.
    expo(),
    bearer({ requireSignature: true }),
    nextCookies(),
  ],
} satisfies BetterAuthOptions

// The OIDC provider is read once per instance (genericOAuth's config is
// static), so Admin → Authentication calls reloadAuth() after a save and the
// next request builds a fresh instance. It signs in through the core
// /sign-in/social and /callback/oidc, like Google. It has no after-hooks, so
// sitting behind nextCookies() is fine.
const build = (oidc: OidcConfig | null, passkeys: boolean) => {
  const rpID = passkeys ? passkeyHost(process.env.BETTER_AUTH_URL) : null
  const origins = passkeyOrigins()
  return betterAuth({
    ...options,
    plugins: [
      ...options.plugins,
      genericOAuth({
        config: oidc
          ? [
              {
                providerId: OIDC_ID,
                name: oidc.name,
                discoveryUrl: discoveryUrl(oidc.issuer),
                clientId: oidc.clientId,
                clientSecret: oidc.clientSecret,
                scopes: ["openid", "email", "profile"],
                pkce: true,
              },
            ]
          : [],
      }),
      ...(rpID
        ? [
            passkey({ rpID, rpName: "Nimbus", origin: origins }),
            passkeyTwoFactor(rpID, origins),
          ]
        : []),
    ],
  })
}

type Auth = ReturnType<typeof build>

// Bumped on globalThis, since route handlers and server actions can each load
// their own copy of this module; each copy rebuilds when it sees a new number.
const g = globalThis as unknown as { nimbusAuthGen?: number }
let current: { gen: number; auth: Promise<Auth> } | undefined

export function getAuth() {
  const gen = g.nimbusAuthGen ?? 0
  if (current?.gen !== gen) {
    const auth = Promise.all([getOidcConfig(), passkeyStatus()])
      .then(([c, p]) => build(oidcReady(c) ? c : null, p.available))
      .catch((e) => {
        current = undefined
        throw e
      })
    current = { gen, auth }
  }
  return current.auth
}

export function reloadAuth() {
  g.nimbusAuthGen = (g.nimbusAuthGen ?? 0) + 1
}

// `auth.api.x(...)` and `auth.$context` use the current instance. `options` is
// for the Better Auth CLI (npx auth generate), which reads the schema from it.
export const auth = {
  api: new Proxy({} as Auth["api"], {
    get:
      (_, name) =>
      async (...args: unknown[]) => {
        const api = (await getAuth()).api as unknown as Record<
          string | symbol,
          (...a: unknown[]) => unknown
        >
        return api[name](...args)
      },
  }),
  get $context() {
    return getAuth().then((a) => a.$context)
  },
  options,
}

export type Session = Auth["$Infer"]["Session"]
