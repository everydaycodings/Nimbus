import { API_VERSION, limitIp } from "@/lib/api"
import { enabledProviders } from "@/lib/auth"
import { appUrl, emailEnabled } from "@/lib/email"
import { getSettings } from "@/lib/signup"
import { uploadLimits } from "@/lib/uploads"
import pkg from "../../../../package.json"

// Public: what the Android app needs before anyone has signed in.
export async function GET() {
  const limited = await limitIp("instance")
  if (limited) return limited
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
      version: pkg.version,
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
