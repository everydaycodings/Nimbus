import { ANDROID_PACKAGE, DEBUG_SHA256 } from "@/lib/passkey-rules"

// Lets the Android app use this server's passkeys: it names the app and the
// certificates it is signed with (release from env, plus the debug one).
export function GET() {
  return Response.json(
    [
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: [
            process.env.ANDROID_RELEASE_SHA256,
            DEBUG_SHA256,
          ].filter(Boolean),
        },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } }
  )
}
