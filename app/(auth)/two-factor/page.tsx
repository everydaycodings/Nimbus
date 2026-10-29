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

export default async function TwoFactorPage() {
  const adding = (await cookies()).has(ADDING_COOKIE)
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Two-factor check</CardTitle>
        <CardDescription className="text-balance">
          Open your authenticator app and enter the 6-digit code for Nimbus.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TwoFactorChallenge />
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
