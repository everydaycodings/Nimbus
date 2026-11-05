import { API_VERSION } from "@/lib/api"
import { enabledProviders } from "@/lib/auth"
import { appUrl, emailEnabled } from "@/lib/email"
import { getSettings } from "@/lib/signup"
import { uploadLimits } from "@/lib/uploads"

// Public: what the Android app needs before anyone has signed in.
export async function GET() {
  const [providers, settings, limits, email] = await Promise.all([
    enabledProviders(),
    getSettings(),
    uploadLimits(),
    emailEnabled(),
  ])
  return Response.json(
    {
      app: "nimbus",
      apiVersion: API_VERSION,
      providers,
      signupMode: settings.signupMode,
      deviceLinks: settings.deviceLinks,
      passwordPolicy: settings.passwordPolicy,
      email,
      tusUrl: new URL(process.env.TUS_URL ?? "/files/", appUrl()).href,
      maxUploadBytes: limits.maxUploadBytes,
      blockedExtensions: limits.blockedExtensions,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
