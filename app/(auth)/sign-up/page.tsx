import { count } from "drizzle-orm"
import { cookies } from "next/headers"
import Link from "next/link"

import { AuthForm } from "@/components/auth-form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { enabledProviders } from "@/lib/auth"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import {
  INVITE_COOKIE,
  SHARE_INVITE_COOKIE,
  findInvite,
  getSettings,
  readShareInvite,
} from "@/lib/signup"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; error?: string }>
}) {
  const [{ n }] = await db.select({ n: count() }).from(user)
  const first = n === 0
  const { signupMode } = await getSettings()
  const jar = await cookies()
  const token = jar.get(INVITE_COOKIE)?.value
  // Shared files waiting for this address skip approval too.
  const sharedTo = await readShareInvite(jar.get(SHARE_INVITE_COOKIE)?.value)
  const invited = Boolean(sharedTo || (token && (await findInvite(token))))
  const params = await searchParams
  const badInvite = params.invite === "invalid"

  // Without a form to show, explain why and point back to sign-in.
  const blocked =
    !first && (signupMode === "closed" || (signupMode === "invite" && !invited))
  if (blocked)
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl text-balance">
            {signupMode === "closed"
              ? "Sign-ups are closed"
              : "Joining needs an invite"}
          </CardTitle>
          <CardDescription className="text-balance">
            {badInvite
              ? "That invite link has expired or was used up. Ask an admin of this Nimbus for a new one."
              : signupMode === "closed"
                ? "This Nimbus isn't taking new accounts right now. Ask the person who runs it if you need access."
                : "This Nimbus is invite only. Ask an admin for an invite link, then open it to create your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-foreground underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    )

  const description = first
    ? "You're the first one here, so this account becomes the owner of this instance."
    : sharedTo
      ? `Files were shared with ${sharedTo}. Create your account with that address and they'll be waiting in Shared files.`
      : invited
        ? "You were invited, so your account is ready as soon as you create it."
        : signupMode === "open"
          ? "Your account is ready as soon as you create it."
          : "An admin of this Nimbus reviews new accounts before they can use it."

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl text-balance">
          {first
            ? "Set up your Nimbus"
            : invited
              ? "You're invited"
              : "Create an account"}
        </CardTitle>
        <CardDescription className="text-balance">
          {badInvite &&
            "That invite link has expired or was used up, so your account will need approval. "}
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm
          mode="sign-up"
          providers={enabledProviders}
          initialError={params.error}
        />
      </CardContent>
    </Card>
  )
}
