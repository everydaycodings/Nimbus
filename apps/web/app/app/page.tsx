import { CloudIcon } from "@phosphor-icons/react/dist/ssr"
import { headers } from "next/headers"
import { renderSVG } from "uqr"

import { AndroidDownload } from "@/components/android-download"
import { androidRelease } from "@/lib/android-release"
import { appUrl } from "@/lib/email"

export const metadata = { title: "Get the Nimbus app" }
export const dynamic = "force-dynamic"

// Public: the Android app. A phone gets the download; a desktop gets a QR that
// opens this page on the phone, and the list.
export default async function AppPage() {
  const [release, ua] = await Promise.all([
    androidRelease(),
    headers().then((h) => h.get("user-agent") ?? ""),
  ])
  const phone = /Android/i.test(ua)
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <span className="grid size-8 place-items-center rounded-lg border bg-card shadow-sm">
          <CloudIcon weight="fill" className="size-5 text-brand" />
        </span>
        Nimbus
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Nimbus for Android</h1>
      {release ? (
        <>
          {!phone && (
            <div className="flex flex-col gap-2">
              <div
                role="img"
                aria-label="QR code that opens this page on your phone"
                className="w-40 rounded-lg bg-white p-2 [&>svg]:size-full"
                dangerouslySetInnerHTML={{
                  __html: renderSVG(new URL("/app", appUrl()).href, { border: 0 }),
                }}
              />
              <p className="text-sm text-muted-foreground">
                Scan with your phone to download it there, or pick a file below.
              </p>
            </div>
          )}
          <AndroidDownload release={release} />
          <p className="text-sm text-muted-foreground">
            After installing, enter this server&apos;s address, or scan the QR
            in Account → Sign in on your phone.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This server has no Android app to offer yet.
        </p>
      )}
      <a href="/sign-in" className="text-sm underline underline-offset-4">
        Sign in
      </a>
    </main>
  )
}
