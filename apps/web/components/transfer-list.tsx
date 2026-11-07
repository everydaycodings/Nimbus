"use client"

import {
  CaretDownIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import {
  getTransferDetails,
  revokeTransfer,
} from "@/app/(app)/transfers/actions"
import { CopyButton } from "@/components/copy-button"
import { TransferDialog } from "@/components/transfer-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/file-types"
import { cn } from "@/lib/utils"
import type {
  Transfer,
  TransferEvent,
  TransferOptions,
  TransferStatus,
} from "@nimbus/shared/api"

const STATUS: Record<TransferStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  closed: "Closed",
}
const WHEN = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})
const VERB = {
  view: "Opened the page",
  download: "Downloaded",
  unlock_fail: "Wrong password",
  save: "Saved to Nimbus",
}

export function TransferList({
  transfers,
  options,
  tusUrl,
  base,
}: {
  transfers: Transfer[]
  options: TransferOptions
  tusUrl: string
  // The server's address, for links.
  base: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">
          Transfers
        </h1>
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New transfer
        </Button>
      </div>
      {transfers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-16 text-center">
          <PaperPlaneTiltIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">You haven&apos;t sent anything yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Send files by email or link. Transfers keep their own copy and
            delete it when they expire.
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {transfers.map((t) => (
            <Row key={t.id} t={t} base={base} />
          ))}
        </ul>
      )}
      <TransferDialog
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        tusUrl={tusUrl}
      />
    </div>
  )
}

function Row({ t, base }: { t: Transfer; base: string }) {
  const [log, setLog] = useState<TransferEvent[] | null>(null)
  const [shown, setShown] = useState(false)
  const [pending, start] = useTransition()
  // Revoke asks once, inline, like the other lists.
  const [sure, setSure] = useState(false)
  const name =
    t.title || (t.fileCount === 1 ? t.files[0].name : `${t.fileCount} files`)
  const link = t.linkToken ? `${base}/t/${t.linkToken}` : null

  function toggle() {
    setShown(!shown)
    if (!log) getTransferDetails(t.id).then((r) => setLog(r?.events ?? []))
  }

  return (
    <li className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={shown}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CaretDownIcon
            className={cn(
              "size-4 shrink-0 transition-transform",
              !shown && "-rotate-90"
            )}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block text-xs text-muted-foreground">
              {t.fileCount} file{t.fileCount === 1 ? "" : "s"} ·{" "}
              {formatBytes(t.bytes)} · {t.downloads}
              {t.downloadLimit !== null && ` of ${t.downloadLimit}`} download
              {(t.downloadLimit ?? t.downloads) === 1 ? "" : "s"} ·{" "}
              {t.status === "active"
                ? `expires ${WHEN.format(new Date(t.expiresAt))}`
                : t.status === "closed"
                  ? `limit reached · copies deleted ${WHEN.format(new Date(t.expiresAt))}`
                  : t.status === "revoked"
                    ? "copies deleted within the hour"
                    : `ended ${WHEN.format(new Date(t.expiresAt))}`}
            </span>
          </span>
        </button>
        <Badge variant={t.status === "active" ? "default" : "secondary"}>
          {STATUS[t.status]}
        </Badge>
        {t.status === "active" && link && <CopyButton value={link} />}
        {(t.status === "active" || t.status === "closed") &&
          (sure ? (
            <span className="flex gap-1">
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await revokeTransfer(t.id)
                    setSure(false)
                  })
                }
              >
                Revoke and delete copies
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setSure(false)}
              >
                Keep
              </Button>
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setSure(true)}>
              Revoke
            </Button>
          ))}
      </div>
      {shown && (
        <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-3 text-sm">
          {t.message && <p className="whitespace-pre-line">{t.message}</p>}
          <p className="text-xs text-muted-foreground">
            Sent to{" "}
            {t.recipients
              .map((r) => r.email ?? "anyone with the link")
              .join(", ")}
            {t.hasPassword && " · password protected"}
          </p>
          <h3 className="text-xs font-medium text-muted-foreground">
            Downloaded by…
          </h3>
          {log === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : log.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {log.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2 text-xs">
                  <span className="font-medium">{e.who}</span>
                  <span>{VERB[e.kind]}</span>
                  {e.detail && e.kind === "download" && (
                    <span className="truncate text-muted-foreground">
                      {e.detail}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {WHEN.format(new Date(e.at))}
                    {e.ip && ` · ${e.ip}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
