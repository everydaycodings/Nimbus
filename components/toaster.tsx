"use client"

import {
  CheckCircleIcon,
  CircleNotchIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Toast } from "@base-ui/react/toast"
import { useCallback, useId } from "react"

import type { ToastPosition } from "@/lib/db/schema"
import { cn } from "@/lib/utils"

export type Notice = { text: string; error?: boolean; undo?: () => void }

const PLACE: Record<ToastPosition, string> = {
  "top-left": "top-16 left-4 flex-col",
  "top-center": "top-16 left-1/2 -translate-x-1/2 flex-col",
  "top-right": "top-16 right-4 flex-col",
  "bottom-left": "bottom-4 left-4 flex-col-reverse",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 flex-col-reverse",
}

// Action results as toasts, where the admin chose (Admin → Settings).
export function Toaster({
  position,
  children,
}: {
  position: ToastPosition
  children: React.ReactNode
}) {
  const top = position.startsWith("top")
  return (
    <Toast.Provider limit={3}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          className={cn(
            "fixed z-50 flex w-[min(28rem,calc(100vw-1rem))] gap-2 outline-none max-sm:inset-x-2 max-sm:w-auto max-sm:translate-x-0",
            PLACE[position]
          )}
        >
          <Toasts top={top} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function Toasts({ top }: { top: boolean }) {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      swipeDirection={top ? "up" : "down"}
      className={cn(
        "flex [transform:translateY(var(--toast-swipe-movement-y))] items-center gap-3 rounded-xl border bg-popover py-2.5 pr-2 pl-3.5 text-sm text-popover-foreground shadow-lg shadow-black/40 transition-[transform,translate,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] select-none data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-opacity",
        top
          ? "data-ending-style:-translate-y-2 data-starting-style:-translate-y-4"
          : "data-ending-style:translate-y-2 data-starting-style:translate-y-4"
      )}
    >
      {t.type === "error" ? (
        <WarningCircleIcon
          weight="fill"
          className="size-4.5 shrink-0 text-destructive"
        />
      ) : t.type === "busy" ? (
        <CircleNotchIcon className="size-4.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
      ) : (
        <CheckCircleIcon
          weight="fill"
          className="size-4.5 shrink-0 text-brand"
        />
      )}
      <Toast.Description className="min-w-0 flex-1 py-0.5 text-pretty" />
      {t.actionProps && (
        <Toast.Action className="shrink-0 rounded-md px-2 py-1 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      )}
      <Toast.Close
        aria-label="Dismiss"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <XIcon className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ))
}

// A drop-in for `useState<Notice | null>`'s setter: each caller owns one toast
// that a new notice replaces and null closes. Notices ending in "…" are
// in-progress and stay up until replaced.
export function useNotice() {
  const id = useId()
  const { add, close } = Toast.useToastManager()
  return useCallback(
    (n: Notice | null) => {
      if (!n) return close(id)
      const busy = n.text.endsWith("…")
      add({
        id,
        description: n.text,
        type: n.error ? "error" : busy ? "busy" : "success",
        priority: n.error ? "high" : "low",
        timeout: busy ? 0 : n.error ? 8000 : 5000,
        actionProps: n.undo ? { children: "Undo", onClick: n.undo } : undefined,
      })
    },
    [id, add, close]
  )
}
