"use client"

import { LinkIcon, PlusIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { useLoad } from "@/components/secrets/access-view"
import { api } from "@/components/secrets/client"
import { Empty } from "@/components/secrets/pki-ui"
import { ShareDialog } from "@/components/secrets/share-dialog"
import { Confirm, Loading } from "@/components/secrets/ui"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Share = { id: string; label: string | null; state: "active" | "viewed" | "expired" | "revoked"; views: number; maxViews: number; password: boolean; expiresAt: string; createdAt: string; firstViewedAt: string | null }

const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

// "Shared by me": the one-time links this member made.
export function SharesView() {
  const notify = useNotice()
  const { data, error, reload } = useLoad<{ shares: Share[]; enabled: boolean }>("/shares")
  const [making, setMaking] = useState(false)
  const [revoke, setRevoke] = useState<Share | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Share links</h2>
        <Button className="ml-auto" onClick={() => setMaking(true)} disabled={data?.enabled === false}>
          <PlusIcon />
          Share text
        </Button>
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        One-time links for people without an account. They open on a click, then burn when their views run out or they expire. Share a secret from its Details panel.
      </p>
      {data?.enabled === false && <p className="rounded-xl border bg-muted/30 px-4 py-3 text-sm">An admin turned share links off on this server.</p>}
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {!data ? (
        <Loading />
      ) : data.shares.length === 0 ? (
        <Empty icon={<LinkIcon />} title="No links yet">
          Make one with Share text, or from a secret&apos;s Details panel.
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {data.shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium">{s.label ?? "Pasted text"}</span>
              <span className="text-muted-foreground">
                {s.views}/{s.maxViews} view{s.maxViews === 1 ? "" : "s"}
                {s.password ? " · password" : ""} · made {stamp.format(new Date(s.createdAt))}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs",
                    s.state === "active" ? "bg-brand/10 text-brand" : s.state === "viewed" ? "bg-muted" : "bg-muted text-muted-foreground"
                  )}
                >
                  {s.state === "active" ? `expires ${stamp.format(new Date(s.expiresAt))}` : s.state === "viewed" ? "viewed" : s.state}
                </span>
                {s.state === "active" && (
                  <Button size="sm" variant="ghost" onClick={() => setRevoke(s)}>Revoke</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {making && <ShareDialog onClose={() => setMaking(false)} onMade={reload} />}
      {revoke && (
        <Confirm
          title="Revoke this link?"
          description="It stops working at once, for everyone."
          action="Revoke"
          danger
          run={async () => {
            await api(`/shares?id=${revoke.id}`, "DELETE")
            notify({ text: "Link revoked." })
            reload()
          }}
          onClose={() => setRevoke(null)}
        />
      )}
    </div>
  )
}
