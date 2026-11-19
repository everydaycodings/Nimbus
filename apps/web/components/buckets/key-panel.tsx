"use client"

import { Dialog } from "@base-ui/react/dialog"
import { ChartLineIcon, XIcon } from "@phosphor-icons/react"

import { KeyBadges } from "@/components/buckets/key-badges"
import { CopyButton } from "@/components/copy-button"
import { DAY, WHEN } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { permsLabel } from "@/lib/s3api/perms"
import type { KeyRow } from "@/lib/s3api/manage"

const at = (d: string | null, fmt = WHEN) => (d ? fmt.format(new Date(d)) : null)

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm text-pretty break-words">{children}</dd>
    </div>
  )
}

const none = <span className="text-muted-foreground">None</span>

// A side sheet with everything about one key. Usage charts and recent calls arrive with metrics.
export function KeyPanel({ k, onClose }: { k: KeyRow | null; onClose: () => void }) {
  return (
    <Dialog.Root open={k !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-[92vw] flex-col border-l bg-popover text-popover-foreground shadow-lg transition-transform duration-200 ease-out outline-none data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none">
          <div className="flex min-h-12 items-center justify-between gap-2 border-b py-2 pr-2 pl-4">
            <Dialog.Title className="min-w-0 text-sm font-semibold break-words">{k?.name}</Dialog.Title>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close key details" className="pointer-coarse:size-11" />}>
              <XIcon />
            </Dialog.Close>
          </div>
          {k && (
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
              <Dialog.Description className="sr-only">Scope, permissions, limits and activity of this access key.</Dialog.Description>
              <KeyBadges k={k} />
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-input/20 px-3 py-2 font-mono text-xs select-all">{k.accessKeyId}</code>
                <CopyButton value={k.accessKeyId} label="Copy access key ID" className="pointer-coarse:h-11" />
              </div>
              <dl className="divide-y">
                <Row label="Permissions">{permsLabel(k.perms)}{k.perms.length ? <span className="block text-xs text-muted-foreground">{k.perms.join(", ")}</span> : null}</Row>
                <Row label="Buckets">{k.allBuckets ? "All buckets" : k.buckets.length ? <span className="font-mono">{k.buckets.join(", ")}</span> : "No buckets left"}</Row>
                <Row label="Prefix">{k.prefix ? <code className="font-mono">{k.prefix}</code> : "Whole bucket"}</Row>
                <Row label="Allowed IPs">
                  {k.allowedIps.length ? <span className="font-mono">{k.allowedIps.join(", ")}</span> : "Any address"}
                </Row>
                <Row label="Expires">{at(k.expiresAt, DAY) ?? "Never"}</Row>
                <Row label="Rotation">
                  {k.rotateEveryDays ? `Reminder every ${k.rotateEveryDays} days` : none}
                  {k.oldSecretUntil && <span className="block text-xs text-muted-foreground">Old secret works until {at(k.oldSecretUntil)}</span>}
                </Row>
                <Row label="Created">{at(k.createdAt)}</Row>
                <Row label="Last rotated">{at(k.rotatedAt) ?? none}</Row>
                <Row label="Last used">{at(k.lastUsedAt) ?? "Never"}</Row>
                <Row label="Last IP">{k.lastIp ? <span className="font-mono">{k.lastIp}</span> : none}</Row>
              </dl>
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center">
                <ChartLineIcon aria-hidden className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">Usage</p>
                <p className="text-xs text-pretty text-muted-foreground">Usage charts arrive with metrics.</p>
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
