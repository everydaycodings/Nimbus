"use client"

import { Menu } from "@base-ui/react/menu"
import { KeyIcon, TrashIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import { revokeKey } from "@/app/(app)/buckets/actions"
import { BucketChips } from "@/components/buckets/bucket-chips"
import { ConfirmDialog } from "@/components/buckets/confirm-dialog"
import { MENU_ITEM } from "@/components/overlay-styles"
import { DAY, Empty, RowMenu, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { KeyRow } from "@/lib/s3api/manage"
import { TABLE, TD, TH } from "@/components/buckets/table-styles"

export const ACCESS = { rw: "Read & write", ro: "Read only" }

const reach = (k: KeyRow) =>
  k.allBuckets ? "All buckets" : k.buckets.length ? `${k.buckets.length} ${k.buckets.length === 1 ? "bucket" : "buckets"}` : "No buckets left"
// Keys shown before "Show all".
const FIRST = 10
const expiry = (k: KeyRow) =>
  k.expiresAt ? `${k.expired ? "Expired" : "Expires"} ${DAY.format(new Date(k.expiresAt))}` : "Never expires"
const used = (k: KeyRow) => (k.lastUsedAt ? WHEN.format(new Date(k.lastUsedAt)) : "Never used")

export function KeyTable({ keys }: { keys: KeyRow[] }) {
  const [all, setAll] = useState(false)
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
  return (
    <div className="flex flex-col gap-3">
      <div className={TABLE.wrap}>
        <table className={TABLE.table}>
          <caption className="sr-only">Access keys</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Name</th>
              <th scope="col" className={`${TH} hidden sm:table-cell`}>Access</th>
              <th scope="col" className={`${TH} hidden md:table-cell`}>Buckets</th>
              <th scope="col" className={`${TH} hidden md:table-cell`}>Expires</th>
              <th scope="col" className={`${TH} hidden lg:table-cell`}>Last used</th>
              <th scope="col" className={`${TH} w-12`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody suppressHydrationWarning>
            {(all ? keys : keys.slice(0, FIRST)).map((k) => (
              <tr key={k.id} className="border-t">
                <th scope="row" className={`${TD} text-left font-normal`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 text-sm font-medium break-words">{k.name}</span>
                    {k.expired && <Badge variant="secondary">Expired</Badge>}
                  </div>
                  <code className="mt-1 block w-fit rounded bg-input/20 px-1.5 py-0.5 font-mono text-xs break-all select-all">
                    {k.accessKeyId}
                  </code>
                  <p className="mt-1 text-xs text-pretty text-muted-foreground md:hidden">
                    <span className="sm:hidden">{ACCESS[k.access]} · </span>
                    {reach(k)} · {expiry(k)} · {used(k)}
                  </p>
                </th>
                <td className={`${TD} hidden sm:table-cell`}>
                  <Badge variant="outline">{ACCESS[k.access]}</Badge>
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  {k.allBuckets || !k.buckets.length ? (
                    <span className="text-xs text-muted-foreground">{reach(k)}</span>
                  ) : (
                    <BucketChips names={k.buckets} />
                  )}
                </td>
                <td className={`${TD} hidden text-xs text-muted-foreground md:table-cell`}>{expiry(k)}</td>
                <td className={`${TD} hidden text-xs text-muted-foreground lg:table-cell`}>
                  {used(k)}
                  {k.lastUsedAt && k.lastIp && <span className="block font-mono">{k.lastIp}</span>}
                </td>
                <td className={`${TD} text-right`}>
                  <RowMenu label={`Actions for ${k.name}`}>
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
