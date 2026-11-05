"use client"

import {
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useState } from "react"

import { emptyTrash, restoreItems, trashItems } from "@/app/(app)/file-actions"
import { deleteOlderVersions } from "@/app/(app)/upload-actions"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { VersionsDialog } from "@/components/versions-dialog"
import { formatBytes } from "@/lib/file-rules"
import { fileType } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import type { Report, ReportRow } from "@/lib/storage-report"
import { cn } from "@/lib/utils"

const LIST = "flex flex-col divide-y rounded-xl border bg-card"
const EMPTY =
  "rounded-xl border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground"
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

// The storage report's lists. `base` is the page's own path, for the folder
// drill-down; `readOnly` (an admin looking at a member) drops every action and
// every link into the member's files.
export function StorageReport({
  report: r,
  base,
  readOnly = false,
}: {
  report: Report
  base: string
  readOnly?: boolean
}) {
  const setNotice = useNotice()
  const [busy, setBusy] = useState<string | null>(null)
  // Inline "are you sure" for the permanent deletes.
  const [confirm, setConfirm] = useState<string | null>(null)
  const [versionsOf, setVersionsOf] = useState<ReportRow | null>(null)

  async function run<T extends { error?: string }>(
    id: string,
    task: () => Promise<T | void>,
    done: (res: T | void) => Parameters<typeof setNotice>[0]
  ) {
    setBusy(id)
    setConfirm(null)
    const res = await task().catch(
      () => ({ error: "Something went wrong. Try again." }) as T
    )
    setBusy(null)
    setNotice(res?.error ? { text: res.error, error: true } : done(res))
  }

  const trash = (f: ReportRow) =>
    run(
      f.id,
      () => trashItems([f.id]),
      () => ({
        text: `Moved “${f.name}” to the trash.`,
        undo: () =>
          run(
            f.id,
            () => restoreItems([f.id]),
            () => ({ text: `Restored “${f.name}”.` })
          ),
      })
    )

  const where = (f: ReportRow) => f.where || "My files"
  const open = (f: ReportRow) => (f.parentId ? `/folders/${f.parentId}` : "/")

  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Largest files"
        note="The 50 biggest files outside the trash and vaults."
      >
        {r.largest.length === 0 ? (
          <p className={EMPTY}>No files yet.</p>
        ) : (
          <ul className={LIST}>
            {r.largest.map((f) => (
              <Row
                key={f.id}
                row={f}
                detail={where(f)}
                href={readOnly ? undefined : open(f)}
              >
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${f.name} to trash`}
                    title="Move to trash"
                    disabled={busy === f.id}
                    className="text-destructive hover:text-destructive"
                    onClick={() => trash(f)}
                  >
                    <TrashIcon />
                  </Button>
                )}
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Old versions"
        note="Earlier versions kept beside the current one. Versions kept forever stay when you delete the rest."
      >
        {r.old.length === 0 ? (
          <p className={EMPTY}>No file has older versions.</p>
        ) : (
          <ul className={LIST}>
            {r.old.map((f) => {
              const deletable = (f.versions ?? 0) - (f.keep ?? 0)
              return (
                <Row
                  key={f.id}
                  row={f}
                  detail={`${plural(f.versions ?? 0, "older version")}${f.keep ? `, ${f.keep} kept forever` : ""} · ${where(f)}`}
                  href={readOnly ? undefined : open(f)}
                >
                  {!readOnly &&
                    (confirm === f.id ? (
                      <>
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busy === f.id}
                          onClick={() =>
                            run(
                              f.id,
                              () => deleteOlderVersions(f.id),
                              (res) => ({
                                text: `Deleted ${plural(res?.count ?? 0, "version")} of “${f.name}”.`,
                              })
                            )
                          }
                        >
                          Delete {plural(deletable, "version")}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setConfirm(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setVersionsOf(f)}
                        >
                          <ClockCounterClockwiseIcon />
                          Versions
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={deletable === 0 || busy === f.id}
                          title={
                            deletable === 0 ? "All kept forever" : undefined
                          }
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirm(f.id)}
                        >
                          Delete older
                        </Button>
                      </>
                    ))}
                </Row>
              )
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Trash"
        note={
          r.trash.count
            ? `${plural(r.trash.count, "item")} · ${formatBytes(r.trash.bytes)}`
            : undefined
        }
        actions={
          !readOnly &&
          r.trash.count > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                render={<Link href="/trash" />}
                nativeButton={false}
              >
                Open trash
              </Button>
              {confirm === "trash" ? (
                <>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === "trash"}
                    onClick={() =>
                      run(
                        "trash",
                        () => emptyTrash(),
                        () => ({ text: "Emptied the trash." })
                      )
                    }
                  >
                    Delete {plural(r.trash.count, "item")} forever
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirm("trash")}
                >
                  Empty trash
                </Button>
              )}
            </>
          )
        }
      >
        {r.trash.count === 0 ? (
          <p className={EMPTY}>The trash is empty.</p>
        ) : (
          <ul className={LIST}>
            {r.trash.top.map((f) => (
              <Row key={f.id} row={f} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Folders" note="What each folder holds, biggest first.">
        <nav
          aria-label="Folder"
          className="flex flex-wrap items-center gap-1 text-sm"
        >
          <Crumb href={base} current={!r.folder.id}>
            My files
          </Crumb>
          {r.folder.path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              <CaretRightIcon className="size-3.5 text-muted-foreground" />
              <Crumb
                href={`${base}?folder=${p.id}`}
                current={i === r.folder.path.length - 1}
              >
                {p.name}
              </Crumb>
            </span>
          ))}
          <span className="ml-auto text-muted-foreground tabular-nums">
            {formatBytes(r.folder.bytes)}
          </span>
        </nav>
        {r.folder.items.length === 0 ? (
          <p className={EMPTY}>This folder is empty.</p>
        ) : (
          <ul className={LIST}>
            {r.folder.items.map((f) => (
              <Row
                key={f.id}
                row={f}
                href={
                  f.kind === "folder" ? `${base}?folder=${f.id}` : undefined
                }
                share={r.folder.bytes ? f.size / r.folder.bytes : 0}
              />
            ))}
          </ul>
        )}
      </Section>

      <VersionsDialog
        // The dialog reads only these.
        item={
          versionsOf &&
          ({
            id: versionsOf.id,
            name: versionsOf.name,
            updatedAt: "",
          } as Item)
        }
        open={Boolean(versionsOf)}
        editable
        onClose={() => setVersionsOf(null)}
      />
    </div>
  )
}

function Section({
  title,
  note,
  actions,
  children,
}: {
  title: string
  note?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {note && (
            <p className="text-sm text-pretty text-muted-foreground tabular-nums">
              {note}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function Crumb({
  href,
  current,
  children,
}: {
  href: string
  current: boolean
  children: React.ReactNode
}) {
  return current ? (
    <span aria-current="page" className="font-medium">
      {children}
    </span>
  ) : (
    <Link
      href={href}
      scroll={false}
      className="rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  )
}

// One file or folder: icon, name and where it is, size, then any actions.
// `share` draws a thin bar of its part of the folder.
function Row({
  row: f,
  detail,
  href,
  share,
  children,
}: {
  row: ReportRow
  detail?: string
  href?: string
  share?: number
  children?: React.ReactNode
}) {
  const t = fileType(f.kind, f.mime, f.name)
  const name = (
    <span className="truncate text-sm" title={f.name}>
      {f.name}
    </span>
  )
  return (
    <li className="flex min-h-file-row items-center gap-3 py-2 pr-2 pl-4">
      <t.icon
        weight={f.kind === "folder" ? "fill" : undefined}
        className={cn("size-5 shrink-0", t.color)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href ? (
          <Link
            href={href}
            scroll={false}
            className="w-fit max-w-full truncate rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            title={f.name}
          >
            {f.name}
          </Link>
        ) : (
          name
        )}
        {detail && (
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
        {share !== undefined && (
          <span
            aria-hidden
            className="h-1 w-full max-w-48 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full bg-muted-foreground/60"
              style={{ width: `${Math.max(1, share * 100)}%` }}
            />
          </span>
        )}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        {formatBytes(f.size)}
      </span>
      {children && (
        <span className="flex shrink-0 items-center gap-1">{children}</span>
      )}
    </li>
  )
}
