"use client"

import { FolderSimpleIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { pathOf } from "@/app/(app)/more/import/actions"
import { MoveDialog } from "@/components/move-dialog"
import { TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"

export type Target = { id: string; path: string }

// The Files folder things are imported into: the existing folder picker, showing the chosen folder's full path.
export function TargetPicker({ value, onChange }: { value: Target | null; onChange: (t: Target) => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" className={`${TOUCH} w-full justify-start sm:w-fit`} onClick={() => setOpen(true)}>
        <FolderSimpleIcon />
        <span className="truncate">{value ? value.path : "Choose a folder"}</span>
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <MoveDialog
        open={open}
        title="Import into which folder?"
        moving={[]}
        start={[{ id: null, name: "My files" }]}
        action="Import here"
        onClose={() => setOpen(false)}
        onMove={(to) => {
          setOpen(false)
          if (!to.id) return setError("Pick a folder inside My files, not My files itself.")
          setError(undefined)
          pathOf(to.id).then((path) => onChange({ id: to.id!, path }), () => setError("Couldn't open that folder."))
        }}
      />
    </div>
  )
}
