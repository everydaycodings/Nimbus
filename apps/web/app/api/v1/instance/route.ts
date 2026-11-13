import { API_VERSION, limitIp } from "@/lib/api"
import { enabledProviders, passkeyStatus } from "@/lib/auth"
import { appUrl, emailEnabled } from "@/lib/email"
import { getSettings } from "@/lib/signup"
import { uploadLimits } from "@/lib/uploads"
import pkg from "../../../../package.json"

// Public: what the Android app needs before anyone has signed in.
export async function GET() {
  const limited = await limitIp("instance")
  if (limited) return limited
  const [providers, settings, limits, email, keys] = await Promise.all([
    enabledProviders(),
    getSettings(),
    uploadLimits(),
    emailEnabled(),
    passkeyStatus(),
  ])
  return Response.json(
    {
      app: "nimbus",
      apiVersion: API_VERSION,
      version: pkg.version,
      providers,
      signupMode: settings.signupMode,
      deviceLinks: settings.deviceLinks,
      passkeys: keys.available,
      vaultLinks: settings.vaultLinksEnabled,
      map: { enabled: settings.mapEnabled, styleUrl: settings.mapStyleUrl },
      passwordPolicy: settings.passwordPolicy,
      email,
      tusUrl: new URL(process.env.TUS_URL ?? "/files/", appUrl()).href,
      maxUploadBytes: limits.maxUploadBytes,
      blockedExtensions: limits.blockedExtensions,
      maxPdfEditBytes: settings.maxPdfEditBytes,
      ai: { speech: settings.mlSpeech, picture: settings.mlClip, faces: settings.mlFaces },
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
