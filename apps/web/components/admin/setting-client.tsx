"use client"

import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Popover } from "@base-ui/react/popover"
import { InfoIcon, WarningIcon } from "@phosphor-icons/react"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"

export type Tip = {
  does: string
  affects: string
  default: string
  example?: string
}

// The (i) next to a setting. Hover or focus on desktop, tap on touch.
export function InfoTip({ label, tip }: { label: string; tip: Tip }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={`About ${label}`}
        className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-popup-open:text-foreground"
      >
        <InfoIcon className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6}>
          <Popover.Popup className="w-72 origin-(--transform-origin) rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Popover.Title className="font-medium">{label}</Popover.Title>
            <Popover.Description className="mt-1 text-pretty text-muted-foreground">
              {tip.does}
            </Popover.Description>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t pt-3 text-xs">
              <dt className="text-muted-foreground">Affects</dt>
              <dd>{tip.affects}</dd>
              <dt className="text-muted-foreground">Default</dt>
              <dd>{tip.default}</dd>
              {tip.example && (
                <>
                  <dt className="text-muted-foreground">Example</dt>
                  <dd>{tip.example}</dd>
                </>
              )}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// A change worth a second look. The field's current value is its DOM default,
// so no saved value has to be passed in.
export type Risk = {
  name: string
  // checked/unchecked: a checkbox flipped that way. equals: a radio or select
  // moved to `value`. fewer: a number or select lowered; blank and 0 mean no limit.
  when: "checked" | "unchecked" | "equals" | "fewer"
  value?: string
  message: string
}

type Field = HTMLInputElement | HTMLSelectElement

function values(form: HTMLFormElement, name: string) {
  const el = form.elements.namedItem(name)
  const fields = (
    el instanceof RadioNodeList ? [...el] : el ? [el] : []
  ) as Field[]
  for (const f of fields) {
    if (f instanceof HTMLSelectElement) {
      const was = [...f.options].find((o) => o.defaultSelected) ?? f.options[0]
      return { now: f.value, was: was?.value ?? "", on: false, wasOn: false }
    }
    if (f.type === "radio") {
      const now = fields.find((r) => (r as HTMLInputElement).checked)
      const was = fields.find((r) => (r as HTMLInputElement).defaultChecked)
      return {
        now: now?.value ?? "",
        was: was?.value ?? "",
        on: false,
        wasOn: false,
      }
    }
    return {
      now: f.value,
      was: f.defaultValue,
      on: f.checked,
      wasOn: f.defaultChecked,
    }
  }
  return null
}

const limit = (v: string) => Number(v) || Infinity

function risky(form: HTMLFormElement, r: Risk) {
  const v = values(form, r.name)
  if (!v) return false
  if (r.when === "checked") return v.on && !v.wasOn
  if (r.when === "unchecked") return !v.on && v.wasOn
  if (r.when === "equals") return v.now === r.value && v.was !== r.value
  return limit(v.now) < limit(v.was)
}

// A form's Save that asks first when one of `risks` applies.
export function ConfirmSave({
  risks = [],
  disabled,
}: {
  risks?: Risk[]
  disabled?: boolean
}) {
  const [found, setFound] = useState<string[]>([])
  const form = useRef<HTMLFormElement | null>(null)

  return (
    <>
      <SubmitButton
        disabled={disabled}
        onClick={(e) => {
          form.current = e.currentTarget.form
          if (!form.current) return
          const hits = risks.filter((r) => risky(form.current!, r))
          if (!hits.length) return
          e.preventDefault()
          setFound(hits.map((r) => r.message))
        }}
      >
        Save
      </SubmitButton>
      <AlertDialog.Root
        open={found.length > 0}
        onOpenChange={(o) => !o && setFound([])}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={DIALOG_BACKDROP} />
          <AlertDialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <AlertDialog.Title className="flex items-center gap-2 text-base font-semibold">
                <WarningIcon
                  weight="fill"
                  className="size-4.5 text-destructive"
                />
                Save this change?
              </AlertDialog.Title>
              <AlertDialog.Description
                render={<div />}
                className="grid gap-2 text-sm text-pretty text-muted-foreground"
              >
                {found.map((m) => (
                  <p key={m}>{m}</p>
                ))}
              </AlertDialog.Description>
            </div>
            <div className="flex justify-end gap-2">
              <AlertDialog.Close render={<Button variant="outline" />}>
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                onClick={() => {
                  setFound([])
                  form.current?.requestSubmit()
                }}
              >
                Save anyway
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}

// Scrolls to and flashes the row named in the URL hash, e.g. after admin search.
export function HashFlash() {
  const path = usePathname()
  useEffect(() => {
    function flash() {
      const id = decodeURIComponent(location.hash.slice(1))
      const el = id && document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ block: "center" })
      el.removeAttribute("data-flash")
      void el.offsetWidth
      el.setAttribute("data-flash", "")
    }
    flash()
    window.addEventListener("hashchange", flash)
    return () => window.removeEventListener("hashchange", flash)
  }, [path])
  return null
}
