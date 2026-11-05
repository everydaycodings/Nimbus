import { BackToSignIn, ForgotPasswordForm } from "@/components/auth-flows"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { emailEnabled } from "@/lib/email"

export default async function ForgotPasswordPage() {
  const email = await emailEnabled()
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription className="text-balance">
          {email
            ? "Enter the email you sign in with and we'll send you a link to choose a new password."
            : "This Nimbus can't send email, so ask an admin to set a temporary password for you. You'll pick your own the next time you sign in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {email ? <ForgotPasswordForm /> : <BackToSignIn />}
      </CardContent>
    </Card>
  )
}
