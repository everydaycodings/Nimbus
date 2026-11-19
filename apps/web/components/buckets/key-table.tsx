"use client"

import { Menu } from "@base-ui/react/menu"
import { ArrowsClockwiseIcon, KeyIcon, PauseCircleIcon, PencilSimpleIcon, PlayCircleIcon, TrashIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { revokeKey, setKeyDisabled } from "@/app/(app)/buckets/actions"
import { BucketChips } from "@/components/buckets/bucket-chips"
import { ConfirmDialog } from "@/components/buckets/confirm-dialog"
import { KeyBadges } from "@/components/buckets/key-badges"
import { KeyDialog, type Made } from "@/components/buckets/key-dialog"
import { KeyPanel } from "@/components/buckets/key-panel"
import { KeyReveal } from "@/components/buckets/key-reveal"
import { RotateDialog } from "@/components/buckets/key-rotate"
import { TABLE, TD, TH } from "@/components/buckets/table-styles"
import { MENU_ITEM } from "@/components/overlay-styles"
import { DAY, Empty, RowMenu, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { permsLabel } from "@/lib/s3api/perms"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"

const reach = (k: KeyRow) =>
  k.allBuckets ? "All buckets" : k.buckets.length ? `${k.buckets.length} ${k.buckets.length === 1 ? "bucket" : "buckets"}` : "No buckets left"
// Keys shown before "Show all".
const FIRST = 10
const expiry = (k: KeyRow) =>
  k.expiresAt ? `${k.expired ? "Expired" : "Expires"} ${DAY.format(new Date(k.expiresAt))}` : "Never expires"
const used = (k: KeyRow) => (k.lastUsedAt ? WHEN.format(new Date(k.lastUsedAt)) : "Never used")

export function KeyTable({ keys, buckets, url, region }: { keys: KeyRow[]; buckets: BucketRow[]; url: string; region: string }) {
  const [all, setAll] = useState(false)
  // Which key each dialog is about, by id, so a refresh shows the latest row.
  const [panel, setPanel] = useState<string | null>(null)
  // The key an edit or rotate dialog is about; it stays set while the dialog fades out.
  const [target, setTarget] = useState<KeyRow | null>(null)
  const [dialog, setDialog] = useState<"edit" | "rotate" | null>(null)
  const [revealed, setRevealed] = useState<Made | null>(null)
  const [revoking, setRevoking] = useState<KeyRow | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  if (keys.length === 0)
    return (
      <Empty icon={KeyIcon} title="No access keys yet">
        Make a key to connect an app. You see its secret once, right after it&apos;s made.
      </Empty>
    )
  const toggle = (k: KeyRow) =>
    start(async () => {
      const r = await setKeyDisabled(k.id, !k.disabled)
      setNotice(r.error ? { text: r.error, error: true } : { text: `${k.disabled ? "Enabled" : "Disabled"} “${k.name}”.` })
    })
  return (
    <div className="flex flex-col gap-3">
      <div className={TABLE.wrap}>
        <table className={TABLE.table}>
          <caption className="sr-only">Access keys. Select a name for its details.</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Name</th>
              <th scope="col" className={`${TH} hidden md:table-cell`}>Key ID</th>
              <th scope="col" className={`${TH} hidden sm:table-cell`}>Access</th>
              <th scope="col" className={`${TH} hidden lg:table-cell`}>Buckets</th>
              <th scope="col" className={`${TH} hidden lg:table-cell`}>Last used</th>
              <th scope="col" className={`${TH} w-12`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody suppressHydrationWarning>
            {(all ? keys : keys.slice(0, FIRST)).map((k) => (
              <tr
                key={k.id}
                className="cursor-pointer border-t hover:bg-accent/30"
                // Mouse users can click anywhere on the row; the name button is the keyboard path.
                onClick={(e) => e.currentTarget.contains(e.target as Node) && !(e.target as HTMLElement).closest("button, a") && setPanel(k.id)}
              >
                <th scope="row" className={`${TD} text-left font-normal`}>
                  <div className="grid gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPanel(k.id)}
                      className="min-w-0 rounded-sm text-left text-sm font-medium break-words outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                    >
                      {k.name}
                    </button>
                    <KeyBadges k={k} />
                    <code className="block w-fit max-w-full rounded bg-input/20 px-1.5 py-0.5 font-mono text-xs break-all select-all md:hidden">
                      {k.accessKeyId}
                    </code>
                    <p className="text-xs text-pretty text-muted-foreground lg:hidden">
                      <span className="sm:hidden">{permsLabel(k.perms)} · </span>
                      {reach(k)} · {expiry(k)} · {used(k)}
                    </p>
                    <p className="hidden text-xs text-muted-foreground lg:block">{expiry(k)}</p>
                  </div>
                </th>
                <td className={`${TD} hidden md:table-cell`}>
                  <code className="rounded bg-input/20 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap select-all">{k.accessKeyId}</code>
                </td>
                <td className={`${TD} hidden sm:table-cell`}>
                  <Badge variant="outline">{permsLabel(k.perms)}</Badge>
                  {k.prefix && <code className="mt-1 block max-w-40 truncate font-mono text-xs text-muted-foreground" title={k.prefix}>{k.prefix}</code>}
                </td>
                <td className={`${TD} hidden whitespace-nowrap lg:table-cell`}>
                  {k.allBuckets || !k.buckets.length ? (
                    <span className="text-xs text-muted-foreground">{reach(k)}</span>
                  ) : (
                    <BucketChips names={k.buckets} />
                  )}
                </td>
                <td className={`${TD} hidden text-xs whitespace-nowrap text-muted-foreground lg:table-cell`}>
                  {used(k)}
                  {k.lastUsedAt && k.lastIp && <span className="block font-mono">{k.lastIp}</span>}
                </td>
                <td className={`${TD} text-right`}>
                  <RowMenu label={`Actions for ${k.name}`}>
                    <Menu.Item className={MENU_ITEM} onClick={() => (setTarget(k), setDialog("rotate"))}>
                      <ArrowsClockwiseIcon />
                      Rotate secret…
                    </Menu.Item>
                    <Menu.Item className={MENU_ITEM} onClick={() => (setTarget(k), setDialog("edit"))}>
                      <PencilSimpleIcon />
                      Edit…
                    </Menu.Item>
                    <Menu.Item className={MENU_ITEM} disabled={pending} onClick={() => toggle(k)}>
                      {k.disabled ? <PlayCircleIcon /> : <PauseCircleIcon />}
                      {k.disabled ? "Enable" : "Disable"}
                    </Menu.Item>
                    <Menu.Item
                      className={`${MENU_ITEM} text-destructive`}
                      onClick={() => {
                        setError(undefined)
                        setRevoking(k)
                      }}
                    >
                      <TrashIcon className="text-destructive!" />
                      Revoke…
                    </Menu.Item>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {keys.length > FIRST && (
        <Button variant="outline" size="sm" className={`${TOUCH} w-fit`} onClick={() => setAll(!all)}>
          {all ? `Show the first ${FIRST}` : `Show all ${keys.length} keys`}
        </Button>
      )}
      <KeyPanel
        k={keys.find((k) => k.id === panel) ?? null}
        onClose={() => setPanel(null)}
        onAction={(a, k) => {
          if (a === "toggle") return toggle(k)
          if (a === "revoke") return setError(undefined), setRevoking(k)
          setTarget(k)
          setDialog(a)
        }}
      />
      <KeyDialog open={dialog === "edit"} editing={target} buckets={buckets} onClose={() => setDialog(null)} />
      <RotateDialog
        k={target}
        open={dialog === "rotate"}
        onClose={() => setDialog(null)}
        onRotated={(m) => {
          setDialog(null)
          setRevealed(m)
        }}
      />
      <KeyReveal made={revealed} rotated url={url} region={region} onDone={() => setRevealed(null)} />
      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke “${revoking?.name ?? ""}”?`}
        body="Apps using this key stop at once. This can't be undone."
        yes="Revoke"
        pending={pending}
        error={error}
        onClose={() => setRevoking(null)}
        onYes={() =>
          start(async () => {
            const r = await revokeKey(revoking!.id)
            if (r.error) return setError(r.error)
            setNotice({ text: `Revoked “${revoking!.name}”.` })
            setRevoking(null)
          })
        }
      />
    </div>
  )
}
