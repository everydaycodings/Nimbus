import { count } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { cancelAddAccount } from "@/app/(app)/actions"
import { AuthForm } from "@/components/auth-form"
import { SavedLogins } from "@/components/saved-logins"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ADDING_COOKIE } from "@/lib/accounts"
import { enabledProviders } from "@/lib/auth"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { savedOnBrowser } from "@/lib/saved-logins"
import { deviceAccounts, getSession } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>
}) {
  // A fresh instance has nobody to sign in as; send the installer to set up the owner.
  const [{ n }] = await db.select({ n: count() }).from(user)
  if (n === 0) redirect("/sign-up")
  const { signupMode } = await getSettings()
  const { error, email } = await searchParams
  // Adding an account on top of this one (see the (auth) layout).
  const jar = await cookies()
  const current = jar.has(ADDING_COOKIE)
    ? (await getSession())?.user
    : undefined
  // Saved logins, minus accounts already signed in here.
  const live = new Set(
    current
      ? (await deviceAccounts()).filter((a) => a.live).map((a) => a.id)
      : []
  )
  const saved = (await savedOnBrowser(jar.getAll())).filter(
    (a) => !live.has(a.userId)
  )

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          {current ? "Add an account" : "Sign in"}
        </CardTitle>
        <CardDescription className="text-balance">
          {current
            ? `You'll stay signed in as ${current.name}.`
            : "Welcome back to your files."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Always mounted: a failed tap re-renders this page without that
            login, and the list keeps its error across that. */}
        <SavedLogins accounts={email ? [] : saved} />
        <AuthForm
          mode="sign-in"
          providers={await enabledProviders()}
          initialError={error}
          initialEmail={email}
          allowSignUp={signupMode !== "closed"}
        />
        {current && (
          <form action={cancelAddAccount} className="text-center">
            <button
              type="submit"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Cancel
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
