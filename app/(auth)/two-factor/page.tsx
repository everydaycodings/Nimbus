import { TwoFactorChallenge } from "@/components/auth-flows"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function TwoFactorPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Two-factor check</CardTitle>
        <CardDescription className="text-balance">
          Open your authenticator app and enter the 6-digit code for Nimbus.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorChallenge />
      </CardContent>
    </Card>
  )
}
