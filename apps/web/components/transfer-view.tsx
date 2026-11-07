"use client"

import {
  CheckCircleIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRef, useState, useTransition } from "react"

import { saveTransfer } from "@/app/t/actions"
import { Previewer, downloadHref } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { Button } from "@/components/ui/button"
import { previewKind } from "@/lib/file-rules"
import { fileType, formatBytes } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

// What a recipient sees: the files, a preview of each, Download all, and Save
// to my Nimbus for people who are signed in. Its token goes to the shared
// Thumb and Previewer as "t:<token>".
export function TransferView({
  token,
  items,
  signedIn,
}: {
  token: string
  items: Item[]
  signedIn: boolean
}) {
  const link = `t:${token}`
  const [preview, setPreview] = useState<string | null>(null)
  const zip = useRef<HTMLFormElement>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const at = items.findIndex((f) => f.id === preview)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-medium text-muted-foreground max-sm:w-full">
          {items.length} file{items.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(items.reduce((n, i) => n + i.size, 0))}
        </h2>
        {/* First on phones, last (rightmost) from sm up. */}
        <Button
          className="max-sm:w-full sm:order-last"
          onClick={() => zip.current?.submit()}
        >
          <DownloadSimpleIcon />
          Download all
        </Button>
        {signedIn ? (
          <Button
            variant="outline"
            className="max-sm:w-full"
            disabled={pending || Boolean(saved)}
            onClick={() =>
              start(async () => {
                setError(null)
                const r = await saveTransfer(token)
                if (r.error) setError(r.error)
                else setSaved(`Saved ${r.saved} to My files`)
              })
            }
          >
            {pending ? (
              <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
            ) : saved ? (
              <CheckCircleIcon weight="fill" className="text-brand" />
            ) : (
              <FloppyDiskIcon />
            )}
            {saved ?? "Save to my Nimbus"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="max-sm:w-full"
            render={<Link href="/sign-in" />}
            nativeButton={false}
          >
            Sign in to save to Nimbus
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {items.map((i) => {
          const t = fileType("file", i.mime, i.name)
          return (
            <li key={i.id} className="flex items-center gap-1 pr-2">
              <button
                type="button"
                onClick={() => setPreview(i.id)}
                className="group flex h-14 min-w-0 flex-1 items-center gap-3 px-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                {/* A text page at 36px is a dark smudge: only photos and videos show theirs. */}
                {/^(image|video)$/.test(previewKind(i.mime, i.name) ?? "") ? (
                  <Thumb
                    item={i}
                    make={false}
                    link={link}
                    className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted/40"
                  >
                    <t.icon className={cn("size-5", t.color)} />
                  </Thumb>
                ) : (
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted/40">
                    <t.icon className={cn("size-5", t.color)} />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {i.name}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBytes(i.size)}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${i.name}`}
                render={
                  <a
                    href={downloadHref(i, undefined, {
                      token: link,
                      download: true,
                    })!}
                  />
                }
                nativeButton={false}
              >
                <DownloadSimpleIcon />
              </Button>
            </li>
          )
        })}
      </ul>

      <form
        ref={zip}
        method="post"
        action={`/t/${token}/zip`}
        className="hidden"
      />

      <Previewer
        shown={at >= 0 ? { item: items[at] } : null}
        open={at >= 0}
        onClose={() => setPreview(null)}
        onPrev={at > 0 ? () => setPreview(items[at - 1].id) : undefined}
        onNext={
          at >= 0 && at < items.length - 1
            ? () => setPreview(items[at + 1].id)
            : undefined
        }
        position={
          items.length > 1 && at >= 0
            ? `${at + 1} of ${items.length}`
            : undefined
        }
        link={{ token: link, download: true }}
      />
    </div>
  )
}
