import {
  CheckCircleIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

import { PasswordForm } from "@/components/password-form"
import { SubmitButton } from "@/components/submit-button"
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
import { account, user } from "@/lib/db/schema"
import { emailEnabled } from "@/lib/email"
import { emailPrefs } from "@/lib/notify"
import { getSession, isAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { setEmailPrefs, setVaultLock } from "./actions"

const KIND_LABEL = {
  shared: "Something is shared with me",
  access_changed: "My access to something changes",
  access_removed: "Someone removes my access",
  file_drop: "Files arrive through my file-drop links",
  edits: "Editors change things in my shared folders (at most hourly)",
  transfer: "Someone offers me ownership of an item",
  signup_request: "Someone asks to join this Nimbus",
} as const

const PROVIDER = { google: "Google", github: "GitHub" } as Record<
  string,
  string
>

export default async function AccountPage() {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  const me = session.user
  const [linked, email, { require2fa }, prefs, [lock]] = await Promise.all([
    db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, me.id)),
    emailEnabled(),
    getSettings(),
    emailPrefs(me.id),
    db
      .select({ minutes: user.vaultLockMinutes })
      .from(user)
      .where(eq(user.id, me.id)),
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email notifications</CardTitle>
          <CardDescription>
            {email
              ? "Everything also shows under the bell. Pick what's worth an email."
              : "This Nimbus can't send email yet, so these apply once an admin sets it up. Everything shows under the bell."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setEmailPrefs} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Email me when</legend>
              {prefs
                .filter(
                  (p) => p.kind !== "signup_request" || isAdmin(me.role)
                )
                .map((p) => (
                  <label
                    key={p.kind}
                    className="flex cursor-pointer items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      name={p.kind}
                      defaultChecked={p.email}
                      className="size-4 accent-primary"
                    />
                    {KIND_LABEL[p.kind]}
                  </label>
                ))}
            </fieldset>
            <SubmitButton className="self-start">Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vault</CardTitle>
          <CardDescription>
            Unlocked vaults lock themselves when you leave this browser alone
            for a while.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setVaultLock} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-2 text-sm font-medium">
              Lock after
              <select
                name="minutes"
                defaultValue={lock?.minutes ?? 15}
                className="h-9 rounded-md border border-input bg-input/30 px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {[5, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes idle
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton>Save</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
