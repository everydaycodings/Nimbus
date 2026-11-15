"use client"

import { useState, useTransition } from "react"

import { setRegistryQuota } from "@/app/(app)/admin/actions"
import { SELECT } from "@/components/admin/setting-styles"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const TOUCH = "pointer-coarse:h-11 pointer-coarse:px-4"

// Confirms inline, naming the item: "Revoke" turns into "Sure? Yes / Keep".
// `undo` adds an Undo button to the toast for soft deletes.
export function ConfirmAction({
  label,
  aria,
  question,
  yes,
  done,
  run,
  undo,
}: {
  label: string
  aria: string
  question: string
  yes: string
  done: string
  run: () => Promise<unknown>
  undo?: () => Promise<unknown>
}) {
  const [sure, setSure] = useState(false)
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  if (!sure)
    return (
      <Button type="button" variant="destructive" size="sm" className={TOUCH} aria-label={aria} onClick={() => setSure(true)}>
        {label}
      </Button>
    )
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{question}</span>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className={TOUCH}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await run()
            setNotice({
              text: done,
              undo: undo && (() => void undo().then(() => setNotice({ text: "Restored." }))),
            })
          })
        }
      >
        {yes}
      </Button>
      <Button type="button" variant="ghost" size="sm" className={TOUCH} autoFocus disabled={pending} onClick={() => setSure(false)}>
        Keep
      </Button>
    </span>
  )
}

export function QuotaForm({ id, name, value, unit }: { id: string; name: string; value: string | number; unit: string }) {
  const setNotice = useNotice()
  return (
    <form
      action={async (fd) => {
        await setRegistryQuota(fd)
        setNotice({ text: `Saved the storage limit for ${name}.` })
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <Input
        name="quota"
        type="number"
        min={0.01}
        step="any"
        aria-label={`Storage limit for ${name}`}
        defaultValue={value}
        placeholder="Default"
        className="w-32 shrink-0"
      />
      <select key={unit} aria-label={`Storage limit unit for ${name}`} name="unit" defaultValue={unit} className={cn(SELECT, "w-20 shrink-0")}>
        <option value="GB">GB</option>
        <option value="TB">TB</option>
      </select>
      <SubmitButton size="sm" variant="outline" className={TOUCH} aria-label={`Save storage limit for ${name}`}>
        Save
      </SubmitButton>
    </form>
  )
}
