"use client"

import { Menu } from "@base-ui/react/menu"
import { CheckCircleIcon, DotsThreeIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState } from "react"

import { MENU_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Small buttons and links grow to a 44px target on touch screens.
export const TOUCH = "pointer-coarse:h-11 pointer-coarse:px-3.5"

export const Switch = ({ className, ...props }: Omit<React.ComponentProps<"input">, "type" | "role">) => (
  <input
    {...props}
    type="checkbox"
    role="switch"
    className={cn(
      "relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-input/30 transition-colors outline-none before:absolute before:top-0.5 before:left-0.5 before:size-3.5 before:rounded-full before:bg-muted-foreground before:transition-transform checked:border-transparent checked:bg-primary checked:before:translate-x-4 checked:before:bg-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:before:transition-none",
      className
    )}
  />
)

// One vocabulary: repositories and teams use Read / Write / Admin, orgs Owner / Write / Read, tokens Pull / Push / Push + Delete.
export const GRANTS = [
  ["read", "Read"],
  ["write", "Write"],
  ["admin", "Admin"],
] as const
export const GRANT_LABEL: Record<string, string> = Object.fromEntries(GRANTS)
export const ORG_ROLES = [
  ["owner", "Owner"],
  ["write", "Write"],
  ["read", "Read"],
] as const
export const ORG_ROLE_LABEL = Object.fromEntries(ORG_ROLES) as Record<"owner" | "write" | "read", string>
export const TOKEN_ACCESS = [
  ["pull", "Pull", "Download images. Like Read."],
  ["push", "Push", "Download and upload images. Like Write."],
  ["delete", "Push + Delete", "Write plus deleting tags and images."],
] as const
export const TOKEN_ACCESS_LABEL = Object.fromEntries(TOKEN_ACCESS.map(([v, l]) => [v, l])) as Record<"pull" | "push" | "delete", string>

export const SECTION = "flex flex-col gap-3"
export const LIST = "divide-y overflow-hidden rounded-xl border bg-card"
export const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
export const WHEN = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
export const RADIO =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm has-checked:border-ring/60 has-checked:bg-input/30"
export const RADIO_INPUT = "size-4 shrink-0 accent-primary"
export const SELECT =
  "h-9 min-w-0 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
export const CODE =
  "block w-full text-left overflow-x-auto rounded-lg bg-input/20 p-3 font-mono text-xs leading-relaxed whitespace-pre"

export function Heading({
  id,
  title,
  hint,
  sub,
  children,
}: {
  id: string
  title: string
  hint: React.ReactNode
  // A heading inside a group (Advanced): one level down, smaller.
  sub?: boolean
  children?: React.ReactNode
}) {
  const H = sub ? "h3" : "h2"
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="mr-auto grid min-w-0 gap-1">
        <H id={id} className={sub ? "text-sm font-semibold" : "text-base font-semibold"}>
          {title}
        </H>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

export function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <div className="flex w-full max-w-lg flex-col items-center gap-3 text-sm text-pretty text-muted-foreground">{children}</div>
    </div>
  )
}

// Confirms inline: the button turns into "question  Yes / Keep". `danger` colours the first step too.
export function Confirm({
  label,
  question,
  yes,
  pending,
  onYes,
  danger = true,
  size = "sm",
  disabled,
  ariaLabel,
}: {
  label: string
  question: string
  yes: string
  pending: boolean
  onYes: () => void
  danger?: boolean
  size?: "sm" | "default"
  disabled?: boolean
  ariaLabel?: string
}) {
  const [sure, setSure] = useState(false)
  const id = useId()
  if (!sure)
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(size === "sm" && TOUCH, danger && "text-destructive hover:text-destructive")}
        onClick={() => setSure(true)}
      >
        {label}
      </Button>
    )
  return (
    <span role="group" aria-describedby={id} className="flex flex-wrap items-center gap-1.5">
      <span id={id} className="text-xs text-muted-foreground">
        {question}
      </span>
      <Button type="button" variant="destructive" size="sm" className={TOUCH} disabled={pending} onClick={onYes}>
        {yes}
      </Button>
      <Button type="button" variant="ghost" size="sm" className={TOUCH} autoFocus disabled={pending} onClick={() => setSure(false)}>
        Keep
      </Button>
    </span>
  )
}

// The ghost ⋯ menu for a row's less common actions. Items are `Menu.Item`s with MENU_ITEM.
export function RowMenu({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} render={<Button variant="ghost" size="icon-sm" aria-label={label} className="pointer-coarse:size-11" />}>
        <DotsThreeIcon weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className={cn("w-56", MENU_POPUP)}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

// `copy`: leaves room for a Copy button in the corner.
export function Code({ children, copy }: { children: string; copy?: boolean }) {
  return <code className={cn(CODE, copy && "pt-12 sm:pt-3 sm:pr-20")}>{children}</code>
}

export type NameCheck = { state: "idle" | "checking" | "ok" | "bad"; error?: string }

// Debounced "is this name free?" while typing. The claim itself re-checks on the server.
export function useNameCheck(name: string, check: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>): NameCheck {
  const [result, setCheck] = useState<NameCheck>({ state: "idle" })
  useEffect(() => {
    if (!name) return setCheck({ state: "idle" })
    let live = true
    setCheck({ state: "checking" })
    const t = setTimeout(async () => {
      const r = await check(name).catch(() => null)
      if (!live) return
      if (!r) setCheck({ state: "idle" })
      else setCheck(r.ok ? { state: "ok" } : { state: "bad", error: r.error })
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
    // `check` is a stable server action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
  return result
}

export function NameStatus({ id, check }: { id: string; check: NameCheck }) {
  return (
    <p id={id} aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-sm">
      {check.state === "checking" && <span className="text-muted-foreground">Checking…</span>}
      {check.state === "ok" && (
        <>
          <CheckCircleIcon aria-hidden className="size-4 text-brand" />
          <span className="text-muted-foreground">Available</span>
        </>
      )}
      {check.state === "bad" && <span className="text-destructive">{check.error}</span>}
    </p>
  )
}

