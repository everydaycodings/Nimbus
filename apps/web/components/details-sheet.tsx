"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { PlusIcon, StarIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { getDetails, type Details } from "@/app/(app)/file-actions"
import type { Version } from "@/app/(app)/upload-actions"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { Thumb } from "@/components/thumb"
import { Button } from "@/components/ui/button"
import {
  VersionList,
  useVersions,
  versionSummary,
} from "@/components/versions-dialog"
import { TAG_DOT, fileType, formatBytes } from "@/lib/file-types"
import type { Item, Tag } from "@/lib/files"

const full = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// Right-hand panel with everything Nimbus knows about one file or folder.
export function DetailsSheet({
  item,
  open,
  onClose,
  tags,
  onTag,
  onNewTag,
  editable = false,
  onAllVersions,
  onPreviewVersion,
}: {
  item: Item | null
  open: boolean
  onClose: () => void
  // Restore and delete versions; off where the viewer can't edit (shared).
  editable?: boolean
  // Opens the full Versions dialog.
  onAllVersions?: () => void
  onPreviewVersion?: (v: Version) => void
  // The viewer's tags, or null where tags can't be edited (the trash).
  tags: Tag[] | null
  onTag: (tagId: string, on: boolean) => void
  onNewTag: () => void
}) {
  const [loaded, setLoaded] = useState<{
    id: string
    details: Details | null
  } | null>(null)
  const details = loaded && loaded.id === item?.id ? loaded.details : undefined

  useEffect(() => {
    if (!open || !item) return
    let live = true
    getDetails(item.id).then(
      (d) => live && setLoaded({ id: item.id, details: d })
    )
    return () => {
      live = false
    }
  }, [open, item])

  if (!item) return null
  const applied = (tags ?? []).filter((t) => item.tags.includes(t.id))
  const unapplied = (tags ?? []).filter((t) => !item.tags.includes(t.id))
  const t = fileType(item.kind, item.mime, item.name)

  const rows: [string, React.ReactNode][] = [
    ["Type", item.kind === "folder" ? "Folder" : (item.mime ?? "Unknown")],
    item.kind === "file"
      ? [
          "Size",
          <span key="s" className="tabular-nums">
            {formatBytes(item.size)}{" "}
            <span className="text-muted-foreground">
              ({item.size.toLocaleString()} bytes)
            </span>
          </span>,
        ]
      : [
          "Contains",
          details?.contents &&
            `${plural(details.contents.folders, "folder")}, ${plural(details.contents.files, "file")} · ${formatBytes(details.contents.bytes)}`,
        ],
    ["Location", details?.location?.join(" / ")],
    ["Owner", details?.owner],
    ["Created", details && full(details.createdAt)],
    ["Modified", full(item.updatedAt)],
    ...(item.trashedAt
      ? [["Trashed", full(item.trashedAt)] as [string, string]]
      : []),
    [
      "Sharing",
      details?.shares === null
        ? "Shared with you"
        : details &&
          (details.shares
            ? `Shared ${plural(details.shares, "time")}`
            : "Only you"),
    ],
    ...(tags
      ? [
          [
            "Tags",
            <div key="t" className="flex flex-wrap items-center gap-1.5">
              {applied.map((t) => (
                <span
                  key={t.id}
                  className="flex h-6 items-center gap-1.5 rounded-full border pr-0.5 pl-2 text-xs"
                >
                  <span className={`size-2 rounded-full ${TAG_DOT[t.color]}`} />
                  {t.name}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 rounded-full"
                    aria-label={`Remove tag ${t.name}`}
                    onClick={() => onTag(t.id, false)}
                  >
                    <XIcon />
                  </Button>
                </span>
              ))}
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button
                      variant="outline"
                      size="xs"
                      className="rounded-full"
                    />
                  }
                >
                  <PlusIcon />
                  Add
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="start" sideOffset={4}>
                    <Menu.Popup
                      className={`z-50 max-h-72 w-48 overflow-y-auto ${MENU_POPUP}`}
                    >
                      {unapplied.map((t) => (
                        <Menu.Item
                          key={t.id}
                          className={MENU_ITEM}
                          onClick={() => onTag(t.id, true)}
                        >
                          <span
                            className={`size-2.5 rounded-full ${TAG_DOT[t.color]}`}
                          />
                          {t.name}
                        </Menu.Item>
                      ))}
                      <Menu.Item className={MENU_ITEM} onClick={onNewTag}>
                        <PlusIcon />
                        New tag…
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>,
          ] as [string, React.ReactNode],
        ]
      : []),
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-96 max-w-[90vw] flex-col border-l bg-popover text-popover-foreground shadow-lg transition-transform duration-200 ease-out outline-none data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none">
          <div className="flex h-12 items-center justify-between border-b pr-2 pl-4">
            <Dialog.Title className="text-sm font-semibold">
              Details
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close details"
                />
              }
            >
              <XIcon />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-6 overflow-y-auto p-4">
            <Thumb
              item={item}
              make={editable}
              className="grid aspect-[4/3] place-items-center rounded-xl border bg-muted/40"
            >
              <t.icon
                weight={item.kind === "folder" ? "fill" : "light"}
                className={`size-16 ${t.color}`}
              />
            </Thumb>
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-base font-semibold break-words">
                {item.name}
              </h2>
              {item.starred && (
                <StarIcon
                  weight="fill"
                  aria-label="Starred"
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                />
              )}
            </div>
            {details === null ? (
              <p className="text-sm text-muted-foreground">
                This item isn&apos;t available anymore.
              </p>
            ) : (
              <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
                {rows
                  .filter(
                    ([k]) => k !== "Location" || details?.location !== null
                  )
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words">
                        {v ?? (
                          <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted/60 align-middle motion-reduce:animate-none" />
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
            {open && item.kind === "file" && details !== null && tags && (
              <Versions
                item={item}
                editable={editable}
                onAll={onAllVersions}
                onPreview={onPreviewVersion}
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// The latest few versions; the full list lives in the Versions dialog.
function Versions({
  item,
  editable,
  onAll,
  onPreview,
}: {
  item: Item
  editable: boolean
  onAll?: () => void
  onPreview?: (v: Version) => void
}) {
  const versions = useVersions(item)
  const n = versions.list?.length ?? 0
  return (
    <section aria-labelledby="versions-heading" className="flex flex-col gap-2">
      <h3 id="versions-heading" className="text-sm font-medium">
        Versions
      </h3>
      <VersionList
        item={item}
        versions={versions}
        editable={editable}
        limit={3}
        onPreview={onPreview}
      />
      {versionSummary(versions) && (
        <p className="text-xs text-muted-foreground">
          {versionSummary(versions)}
        </p>
      )}
      {onAll && n > 3 && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onAll}
        >
          See all versions
        </Button>
      )}
    </section>
  )
}
