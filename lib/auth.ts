import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { count } from "drizzle-orm"

import { db } from "./db"
import * as schema from "./db/schema"
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
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  socialProviders: {
    ...(google && { google }),
    ...(github && { github }),
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "pending", input: false },
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
      },
    },
  },
  plugins: [nextCookies()],
})

export type Session = typeof auth.$Infer.Session
