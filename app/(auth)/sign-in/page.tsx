import { count } from "drizzle-orm"
import { redirect } from "next/navigation"

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
import { getSettings } from "@/lib/signup"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  // A fresh instance has nobody to sign in as; send the installer to set up the owner.
  const [{ n }] = await db.select({ n: count() }).from(user)
  if (n === 0) redirect("/sign-up")
  const { signupMode } = await getSettings()
  const { error } = await searchParams

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription className="text-balance">Welcome back to your files.</CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm
          mode="sign-in"
          providers={enabledProviders}
          initialError={error}
          allowSignUp={signupMode !== "closed"}
        />
      </CardContent>
    </Card>
  )
}
