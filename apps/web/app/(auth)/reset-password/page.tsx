import Link from "next/link"

import { BackToSignIn, ResetPasswordForm } from "@/components/auth-flows"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Better Auth sends people here as ?token=… or, for a dead link, ?error=INVALID_TOKEN.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams

  if (!token || error)
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">This link doesn&apos;t work</CardTitle>
          <CardDescription className="text-balance">
            Reset links work once, for one hour. Ask for a new one and use the
            newest email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            nativeButton={false}
            render={<Link href="/forgot-password" />}
            className="w-full"
          >
            Get a new link
          </Button>
          <BackToSignIn />
        </CardContent>
      </Card>
    )

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription className="text-balance">
          Saving it signs you out on every device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} />
      </CardContent>
    </Card>
  )
}
