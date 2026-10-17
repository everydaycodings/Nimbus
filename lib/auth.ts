import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { twoFactor } from "better-auth/plugins"
import { and, count, eq, inArray } from "drizzle-orm"

import { db } from "./db"
import * as schema from "./db/schema"
import { appUrl, message, sendInBackground } from "./email"
import {
  INVITE_COOKIE,
  claimInvite,
  getSettings,
  isTrustedEmail,
} from "./signup"

// A provider is offered only when both of its keys are set.
function provider(id: "GOOGLE" | "GITHUB") {
  const clientId = process.env[`${id}_CLIENT_ID`]
  const clientSecret = process.env[`${id}_CLIENT_SECRET`]
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

const google = provider("GOOGLE")
const github = provider("GITHUB")

export const enabledProviders = {
  google: Boolean(google),
  github: Boolean(github),
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
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
    },
  },
  databaseHooks: {
    user: {
      create: {
        // The first account owns the instance. After that the admin-chosen sign-up
        // mode decides; a trusted domain or an invite link skips approval. This hook
        // is the only gate, so email and OAuth sign-ups are both covered.
        // The one-owner unique index rejects a second owner if two sign-ups race.
        before: async (user, ctx) => {
          const [{ n }] = await db.select({ n: count() }).from(schema.user)
          if (n === 0)
            return { data: { ...user, role: "owner", status: "active" } }

          const { signupMode, trustedDomains } = await getSettings()
          if (signupMode === "closed")
            throw new APIError("FORBIDDEN", {
              message: "Sign-ups are closed on this Nimbus.",
            })

          // Only provider-verified emails count; password emails aren't verified yet.
          const trusted =
            user.emailVerified && isTrustedEmail(user.email, trustedDomains)
          const token = ctx?.getCookie(INVITE_COOKIE)
          const invited =
            !trusted &&
            signupMode !== "open" &&
            Boolean(token && (await claimInvite(token)))

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
        // Tell the admins someone is waiting.
        after: async (created) => {
          if ((created as { status?: string }).status !== "pending") return
          const admins = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(
              and(
                inArray(schema.user.role, ["owner", "admin"]),
                eq(schema.user.status, "active")
              )
            )
          for (const { email } of admins)
            sendInBackground(
              message({
                to: email,
                subject: `${created.name} wants to join your Nimbus`,
                lines: [
                  `${created.name} (${created.email}) created an account and is waiting for approval.`,
                ],
                action: {
                  label: "Review request",
                  url: appUrl("/admin/members?tab=pending"),
                },
              })
            )
        },
      },
    },
  },
  hooks: {
    // The UI hides "Turn off" when an admin requires two-factor; this covers direct calls.
    before: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path === "/two-factor/disable" &&
        (await getSettings()).require2fa
      )
        throw new APIError("FORBIDDEN", {
          message: "Your admin requires two-factor on this Nimbus.",
        })
    }),
  },
  plugins: [twoFactor({ issuer: "Nimbus" }), nextCookies()],
})

export type Session = typeof auth.$Infer.Session
