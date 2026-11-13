import { notFound } from "next/navigation"

import { SecretsShell } from "@/components/secrets/shell"
import { UnlockPanel } from "@/components/secrets/unlock-panel"
import { kmsConfigured } from "@/lib/secrets/kms"
import { policy } from "@/lib/secrets/service"
import { methodsFor, unlockState } from "@/lib/secrets/unlock"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Secrets · Nimbus" }
export const dynamic = "force-dynamic"

// Everything under /secrets sits behind the unlock. Pages also check it (see
// lib/secrets/page.ts), since layouts and pages render separately.
export default async function SecretsLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMember()
  if (!(await policy()).enabled) notFound()
  if (!kmsConfigured())
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Secrets isn&apos;t set up</h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          This server has no SECRETS_ROOT_KEY. Ask an admin to add one (see Admin → Secrets).
        </p>
      </div>
    )
  const st = await unlockState(false)
  const m = await methodsFor(me)
  if (!st?.unlocked) return <UnlockPanel methods={m.methods} minutes={m.lockMinutes} />
  return <SecretsShell minutes={m.lockMinutes}>{children}</SecretsShell>
}
