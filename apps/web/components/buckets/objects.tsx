"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { CopyIcon, DownloadSimpleIcon, FileIcon, FolderIcon, LinkIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState, useTransition } from "react"

import { moreObjects, presignObject } from "@/app/(app)/buckets/actions"
import { TABLE, TD, TH } from "@/components/buckets/table-styles"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM } from "@/components/overlay-styles"
import { Empty, RowMenu, Segmented, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-types"
import type { ObjectRow } from "@/lib/s3api/manage"

const LINK =
  "rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
const EXPIRES = [
  ["3600", "1 hour"],
  ["86400", "1 day"],
  ["604800", "7 days"],
] as const

export function ObjectBrowser({
  bucket,
  prefix,
  initial,
  canShare,
}: {
  bucket: { id: string; name: string }
  prefix: string
  initial: { items: ObjectRow[]; next: string | null }
  canShare: boolean
}) {
  const [items, setItems] = useState(initial.items)
  const [next, setNext] = useState(initial.next)
  const [more, startMore] = useTransition()
  const [error, setError] = useState<string>()
  const [sharing, setSharing] = useState<string | null>(null)
  const setNotice = useNotice()
  const base = `/buckets/${bucket.name}`
  const here = (p: string) => (p ? `${base}?tab=objects&prefix=${encodeURIComponent(p)}` : `${base}?tab=objects`)
  const parts = prefix.split("/").filter(Boolean)

  const copyUri = async (key: string) => {
    await navigator.clipboard.writeText(`s3://${bucket.name}/${key}`)
    setNotice({ text: "Copied the s3:// address." })
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Objects">
      <nav aria-label="Folder path">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          <li>
            <Link href={here("")} className={`${LINK} font-mono ${TOUCH} flex items-center`} aria-current={parts.length ? undefined : "page"}>
              {bucket.name}
            </Link>
          </li>
          {parts.map((p, i) => {
            const to = parts.slice(0, i + 1).join("/") + "/"
            return (
              <li key={to} className="flex items-center gap-1">
                <span aria-hidden className="text-muted-foreground">/</span>
                <Link href={here(to)} className={`${LINK} font-mono ${TOUCH} flex items-center`} aria-current={i === parts.length - 1 ? "page" : undefined}>
                  {p}
                </Link>
              </li>
            )
          })}
        </ol>
      </nav>

      {items.length === 0 ? (
        <Empty icon={FolderIcon} title={prefix ? "This folder is empty" : "No objects yet"}>
          {prefix ? "Nothing is stored under this path." : "Files apps upload to this bucket show up here. Browsing is read-only; change files in Files."}
        </Empty>
      ) : (
        <div className={TABLE.wrap}>
          <table className={TABLE.table}>
            <caption className="sr-only">Objects in {bucket.name}{prefix ? ` under ${prefix}` : ""}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Name</th>
                <th scope="col" className={`${TH} hidden sm:table-cell`}>Size</th>
                <th scope="col" className={`${TH} hidden lg:table-cell`}>ETag</th>
                <th scope="col" className={`${TH} hidden md:table-cell`}>Modified</th>
                <th scope="col" className={`${TH} hidden md:table-cell`}>Versions</th>
                <th scope="col" className={`${TH} w-24`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody suppressHydrationWarning>
              {items.map((o) => {
                const name = o.key.slice(prefix.length)
                return (
                  <tr key={o.key} className="border-t">
                    <th scope="row" className={`${TD} text-left font-normal`}>
                      <div className="flex items-start gap-2">
                        {o.folder ? (
                          <FolderIcon aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-file-folder" />
                        ) : (
                          <FileIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          {o.folder ? (
                            <Link href={here(o.key)} className={`${LINK} font-mono text-sm break-all`}>
                              {name}
                            </Link>
                          ) : (
                            <span className="font-mono text-sm break-all">{name}</span>
                          )}
                          {!o.folder && (
                            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums sm:hidden">
                              {formatBytes(o.size)} · {WHEN.format(new Date(o.at))}
                            </p>
                          )}
                        </div>
                      </div>
                    </th>
                    <td className={`${TD} hidden tabular-nums sm:table-cell`}>{o.folder ? "–" : formatBytes(o.size)}</td>
                    <td className={`${TD} hidden lg:table-cell`}>
                      {o.folder ? "–" : <code className="block max-w-36 truncate font-mono text-xs text-muted-foreground" title={o.etag}>{o.etag}</code>}
                    </td>
                    <td className={`${TD} hidden text-xs text-muted-foreground md:table-cell`}>{o.folder ? "–" : WHEN.format(new Date(o.at))}</td>
                    <td className={`${TD} hidden tabular-nums md:table-cell`}>{o.folder ? "–" : o.versions}</td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {!o.folder && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="pointer-coarse:size-11"
                          aria-label={`Download ${name}`}
                          nativeButton={false}
                          render={<a href={`/api/files/${o.nodeId}/download`} download />}
                        >
                          <DownloadSimpleIcon />
                        </Button>
                      )}
                      <RowMenu label={`Actions for ${name}`}>
                        <Menu.Item className={MENU_ITEM} onClick={() => copyUri(o.key)}>
                          <CopyIcon />
                          Copy s3:// URI
                        </Menu.Item>
                        {!o.folder && (
                          <Menu.Item className={MENU_ITEM} onClick={() => setSharing(o.key)}>
                            <LinkIcon />
                            Share link…
                          </Menu.Item>
                        )}
                      </RowMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {next && (
        <div className="flex flex-col items-center gap-2">
          <Button
            variant="outline"
            disabled={more}
            onClick={() =>
              startMore(async () => {
                const r = await moreObjects(bucket.id, prefix, next)
                if (!r) return setError("Couldn't load more. Refresh and try again.")
                setItems((cur) => [...cur, ...r.items])
                setNext(r.next)
              })
            }
          >
            {more ? "Loading…" : "Load more"}
          </Button>
          <FormError>{error}</FormError>
        </div>
      )}

      <ShareLink bucketId={bucket.id} objectKey={sharing} canShare={canShare} onClose={() => setSharing(null)} />
    </section>
  )
}

function ShareLink({
  bucketId,
  objectKey,
  canShare,
  onClose,
}: {
  bucketId: string
  objectKey: string | null
  canShare: boolean
  onClose: () => void
}) {
  const [seconds, setSeconds] = useState("86400")
  const [link, setLink] = useState<string>()
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  // Keep the key through the fade-out so the title doesn't blank.
  const [shown, setShown] = useState<string | null>(null)
  if (objectKey && objectKey !== shown) {
    setShown(objectKey)
    setLink(undefined)
    setError(undefined)
  }
  return (
    <Dialog.Root open={objectKey !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={`${DIALOG_POPUP} max-h-[calc(100svh-2rem)] overflow-y-auto`}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">Share a link</Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {canShare ? (
                <>
                  Anyone with the link can download <span className="font-mono break-all">{shown}</span> until it runs out.
                </>
              ) : (
                "Make an access key to share links."
              )}
            </Dialog.Description>
          </div>
          {canShare ? (
            <>
              <div className="grid gap-2">
                <span className="text-sm font-medium">
                  Link works for
                </span>
                <Segmented label="Link works for" value={seconds} options={EXPIRES} onChange={(v) => { setSeconds(v); setLink(undefined) }} />
              </div>
              {link && (
                <div className="flex min-w-0 items-center gap-2">
                  <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-xs select-all" aria-label="Share link">
                    {link}
                  </code>
                  <CopyButton value={link} />
                </div>
              )}
              <FormError>{error}</FormError>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Links are signed with one of your access keys.{" "}
              <Link href="/buckets?tab=keys" className="underline underline-offset-4">
                Go to Access keys
              </Link>
              .
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close render={<Button variant="outline" />}>Close</Dialog.Close>
            {canShare && !link && (
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError(undefined)
                    const r = await presignObject(bucketId, shown!, Number(seconds))
                    if (r.error || !("url" in r) || !r.url) return setError(r.error ?? "Couldn't make the link.")
                    setLink(r.url)
                  })
                }
              >
                Create link
              </Button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
