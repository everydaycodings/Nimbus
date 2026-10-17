import {
  CheckCircleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

import { PasswordForm } from "@/components/password-form"
import { ResendVerification } from "@/components/resend-verification"
import { TwoFactorManage, TwoFactorSetup } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { UserAvatar } from "@/components/user-avatar"
import { db } from "@/lib/db"
import { account } from "@/lib/db/schema"
import { emailEnabled } from "@/lib/email"
import { getSession } from "@/lib/session"
import { getSettings } from "@/lib/signup"

const PROVIDER = { google: "Google", github: "GitHub" } as Record<
  string,
  string
>

export default async function AccountPage() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  const me = session.user
  const [linked, email, { require2fa }] = await Promise.all([
    db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, me.id)),
    emailEnabled(),
    getSettings(),
  ])
  const password = linked.some((a) => a.providerId === "credential")
  const providers = linked
    .map((a) => PROVIDER[a.providerId])
    .filter(Boolean)
    .join(" and ")

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          How you sign in to this Nimbus, and how that&apos;s protected.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <UserAvatar name={me.name} image={me.image} size={40} />
            <div className="grid min-w-0 gap-0.5">
              <p className="truncate font-medium">{me.name}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="truncate">{me.email}</span>
                {me.emailVerified ? (
                  <Badge variant="outline">
                    <CheckCircleIcon weight="fill" className="text-brand" />
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="outline">Not verified</Badge>
                )}
              </p>
            </div>
          </div>
          {!me.emailVerified && email && (
            <div className="flex flex-col gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Confirm this address so you can later sign in with Google or
                GitHub using the same email.
              </p>
              <ResendVerification />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>
            {password
              ? "Changing it signs you out everywhere else."
              : `You sign in with ${providers || "a provider"}, so Nimbus doesn't keep a password for you.`}
          </CardDescription>
        </CardHeader>
        {password && (
          <CardContent>
            <PasswordForm />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Two-factor authentication
            {me.twoFactorEnabled && (
              <Badge variant="outline">
                <ShieldCheckIcon weight="fill" className="text-brand" />
                On
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {!password
              ? `Two-factor protects password sign-ins. For ${providers || "your provider"}, turn it on in that account instead.`
              : me.twoFactorEnabled
                ? "Signing in with your password also asks for a code from your authenticator app."
                : "Ask for a code from your phone after your password, so a leaked password alone can't get in."}
          </CardDescription>
        </CardHeader>
        {password && (
          <CardContent className="flex flex-col gap-4">
            {me.twoFactorEnabled ? (
              <TwoFactorManage locked={require2fa} />
            ) : (
              <>
                {require2fa && (
                  <p className="flex items-center gap-2 text-sm">
                    <WarningCircleIcon className="size-4 text-muted-foreground" />
                    Your admin requires two-factor on this Nimbus.
                  </p>
                )}
                <TwoFactorSetup />
              </>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
