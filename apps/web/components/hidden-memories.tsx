"use client"

import { CalendarBlankIcon, EyeIcon, FolderSimpleIcon, ImageIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState } from "react"

import { getHides, showInMemories } from "@/app/(app)/photo-actions"
import { Button } from "@/components/ui/button"
import type { MemoryHide } from "@nimbus/shared/api"

const ICON = { photo: ImageIcon, folder: FolderSimpleIcon, day: CalendarBlankIcon }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const title = (h: MemoryHide) =>
  h.kind === "day"
    ? `Every ${MONTHS[Number(h.day!.slice(0, 2)) - 1]} ${Number(h.day!.slice(3))}`
    : (h.name ?? "Deleted item")
const sub = { photo: "Photo", folder: "Folder, with everything in it", day: "Day, in every year" }

// What you keep out of "On this day", each with a way back in.
export function HiddenList({ first }: { first: MemoryHide[] }) {
  const [hides, setHides] = useState(first)
  const [busy, setBusy] = useState<string | null>(null)
  async function show(id: string) {
    setBusy(id)
    await showInMemories(id)
    setHides(await getHides())
    setBusy(null)
  }
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/photos" className="text-sm text-muted-foreground hover:text-foreground">
          ← Photos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Hidden from memories</h1>
        <p className="text-sm text-muted-foreground">
          These never show up in On this day. Show one again to bring it back.
        </p>
      </div>
      {hides.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing is hidden. Use the ⋯ menu on a memory to hide a photo, a day or a folder.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {hides.map((h) => {
            const Icon = ICON[h.kind]
            return (
              <li key={h.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{title(h)}</p>
                  <p className="text-xs text-muted-foreground">{sub[h.kind]}</p>
                </div>
                <Button variant="outline" size="sm" disabled={busy === h.id} onClick={() => show(h.id)}>
                  <EyeIcon />
                  Show again
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
