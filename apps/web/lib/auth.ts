import { randomBytes } from "node:crypto"

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
import { genericOAuth, multiSession, twoFactor } from "better-auth/plugins"
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
  h?.get("x-forwarded-for")?.split(",")[0].trim() || h?.get("x-real-ip") || null

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
  /^\/(sign-in\/email|sign-up\/email|two-factor\/verify-(totp|backup-code)|callback\/)/

const accountMemory = {
  id: "nimbus-accounts",
  endpoints: {
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
          // Mirrors the two-factor plugin after a password sign-in: a signed
          // cookie naming a short-lived verification row, which /two-factor
          // turns into a session once the code checks out.
          const maxAge = 600
          const cookie = ctx.context.createAuthCookie("two_factor", { maxAge })
          const identifier = `2fa-${randomBytes(15).toString("hex")}`
          const expiresAt = new Date(Date.now() + maxAge * 1000)
          await ctx.context.internalAdapter.createVerificationValue({
            value: saved.userId,
            identifier,
            expiresAt,
          })
          await ctx.context.internalAdapter.createVerificationValue({
            value: "0",
            identifier: `2fa-attempts-${identifier}`,
            expiresAt,
          })
          await ctx.setSignedCookie(
            cookie.name,
            identifier,
            ctx.context.secret,
            cookie.attributes
          )
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
    ],
  },
} satisfies BetterAuthPlugin

// Everything but the OIDC provider, which build() adds.
const options = {
  database: drizzleAdapter(db, { provider: "pg", schema }),
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
    // The admin's lower limit is checked before adding (app/(app)/actions.ts).
    multiSession({ maximumSessions: MAX_SESSIONS }),
    accountMemory,
    nextCookies(),
  ],
} satisfies BetterAuthOptions

// The OIDC provider is read once per instance (genericOAuth's config is
// static), so Admin → Authentication calls reloadAuth() after a save and the
// next request builds a fresh instance. It signs in through the core
// /sign-in/social and /callback/oidc, like Google. It has no after-hooks, so
// sitting behind nextCookies() is fine.
const build = (oidc: OidcConfig | null) =>
  betterAuth({
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
    ],
  })

type Auth = ReturnType<typeof build>

// Bumped on globalThis, since route handlers and server actions can each load
// their own copy of this module; each copy rebuilds when it sees a new number.
const g = globalThis as unknown as { nimbusAuthGen?: number }
let current: { gen: number; auth: Promise<Auth> } | undefined

export function getAuth() {
  const gen = g.nimbusAuthGen ?? 0
  if (current?.gen !== gen) {
    const auth = getOidcConfig()
      .then((c) => build(oidcReady(c) ? c : null))
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
