import { cookies } from "next/headers"

import { cancelAddAccount } from "@/app/(app)/actions"
import { TwoFactorChallenge } from "@/components/auth-flows"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ADDING_COOKIE } from "@/lib/accounts"
import { passkeyStatus } from "@/lib/auth"

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const adding = (await cookies()).has(ADDING_COOKIE)
  // Where a provider sign-in was heading; only a path on this site.
  const { next } = await searchParams
  const to = next && /^\/(?![/\\])/.test(next) ? next : "/"
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Two-factor check</CardTitle>
        <CardDescription className="text-balance">
          Open your authenticator app and enter the 6-digit code for Nimbus.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TwoFactorChallenge
          next={to}
          passkeys={(await passkeyStatus()).available}
        />
        {adding && (
          <form action={cancelAddAccount} className="text-center">
            <button
              type="submit"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Cancel adding this account
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
