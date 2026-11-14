"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import { XIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function Modal({
  title,
  description,
  onClose,
  wide,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] overflow-y-auto", wide && "max-w-2xl")}>
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 gap-1">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-pretty text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// A yes/no with a named action; `run` may throw, and its message shows inside.
export function Confirm({
  title,
  description,
  action,
  danger,
  run,
  onClose,
}: {
  title: string
  description: string
  action: string
  danger?: boolean
  run: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={title} description={description} onClose={onClose}>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <SubmitButton
          type="button"
          variant={danger ? "destructive" : "default"}
          pending={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await run()
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong.")
              setBusy(false)
            }
          }}
        >
          {action}
        </SubmitButton>
      </div>
    </Modal>
  )
}

export type MenuEntry = {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  separator?: boolean
}

export function MenuButton({
  label,
  trigger,
  items,
  align = "end",
  className,
}: {
  label: string
  trigger: React.ReactNode
  items: MenuEntry[]
  align?: "start" | "end"
  className?: string
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-muted",
          className
        )}
      >
        {trigger}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align={align} sideOffset={4}>
          <Menu.Popup className={`min-w-44 ${MENU_POPUP}`}>
            {items.map((it) => (
              <div key={it.label}>
                {it.separator && <Menu.Separator className="-mx-1 my-1 h-px bg-border" />}
                <Menu.Item
                  className={cn(MENU_ITEM, it.danger && "text-destructive [&_svg]:text-destructive")}
                  onClick={it.onClick}
                >
                  {it.icon}
                  {it.label}
                </Menu.Item>
              </div>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export const SELECT =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

export const CHECKBOX = "size-4 shrink-0 accent-primary"

// Placeholder rows while a list loads, shaped like the bordered lists they stand in for.
export function Loading({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col divide-y rounded-xl border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <span className="h-3.5 w-1/3 max-w-56 rounded bg-muted motion-safe:animate-pulse" />
          <span className="h-3 w-1/5 max-w-32 rounded bg-muted/60 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}
