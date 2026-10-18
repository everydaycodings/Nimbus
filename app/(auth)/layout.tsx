import { CloudIcon } from "@phosphor-icons/react/dist/ssr"
import { redirect } from "next/navigation"

import { PasswordPolicyProvider } from "@/components/password-input"
import { getSession } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (await getSession()) redirect("/")
  const { passwordPolicy } = await getSettings()
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center justify-center px-4 py-12">
      {/* Hairline grid that fades out from behind the card. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_50%_45%_at_50%_45%,black,transparent)] bg-size-[2.5rem_2.5rem] opacity-60"
      />
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg border bg-card shadow-sm">
            <CloudIcon weight="fill" className="size-5 text-brand" />
          </span>
          Nimbus
        </div>
        <div className="[&>[data-slot=card]]:shadow-lg [&>[data-slot=card]]:shadow-black/30">
          <PasswordPolicyProvider policy={passwordPolicy}>
            {children}
          </PasswordPolicyProvider>
        </div>
        <p className="text-center text-xs text-balance text-muted-foreground">
          Self-hosted and open source. Your files stay on this server&apos;s
          storage.
        </p>
      </div>
    </main>
  )
}
