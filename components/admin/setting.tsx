import { ArrowLeftIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { resetSetting } from "@/app/(app)/admin/actions"
import {
  ConfirmSave,
  InfoTip,
  type Risk,
  type Tip,
} from "@/components/admin/setting-client"
import { Badge } from "@/components/ui/badge"
import { isModified, type SettingKey, type Settings } from "@/lib/signup"
import { cn } from "@/lib/utils"

export { SELECT } from "./setting-styles"

export const UNIT_BYTES = { MB: 2 ** 20, GB: 2 ** 30, TB: 2 ** 40 }
type Unit = keyof typeof UNIT_BYTES

// A byte limit as a number-and-unit form field: the bigger unit once it's at least one of them.
export function sizeField(bytes: number | null, small: Unit, big: Unit) {
  if (bytes === null) return { value: "", unit: big }
  const unit = bytes < UNIT_BYTES[big] ? small : big
  return { value: String(+(bytes / UNIT_BYTES[unit]).toFixed(2)), unit }
}

// Rows that can go back to their default: `const reset = resettable(s)`,
// then `reset={reset("maxUploadBytes")}`.
export const resettable =
  (s: Settings) =>
  (...keys: SettingKey[]) => ({ keys, modified: isModified(s, ...keys) })

export function AdminPage({
  title,
  description,
  wide,
  back,
  children,
}: {
  title: string
  description: string
  // A link above the title, for pages inside a section.
  back?: { href: string; label: string }
  // Tables use the room; forms stay at a readable width.
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-10",
        wide ? "max-w-6xl" : "max-w-3xl"
      )}
    >
      <header className="grid gap-1">
        {back && (
          <Link
            href={back.href}
            className="mb-3 flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ArrowLeftIcon className="size-4" />
            {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      </header>
      {children}
    </div>
  )
}

function Heading({
  title,
  description,
}: {
  title?: string
  description?: React.ReactNode
}) {
  if (!title && !description) return null
  return (
    <div className="grid gap-1">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {description && (
        <p className="text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}

export const FRAME = "rounded-xl border bg-card"

// A titled group of rows that aren't one form, like lists with their own buttons.
export function Section({
  title,
  description,
  children,
}: {
  title?: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <Heading title={title} description={description} />
      <div className={cn(FRAME, "divide-y")}>{children}</div>
    </section>
  )
}

// A titled group of rows saved together by one Save.
export function SettingsForm({
  action,
  title,
  description,
  risks,
  disabled,
  note,
  children,
}: {
  action: (form: FormData) => Promise<void>
  title?: string
  description?: React.ReactNode
  risks?: Risk[]
  disabled?: boolean
  // Left of Save, e.g. why it's disabled.
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <Heading title={title} description={description} />
      <form action={action} className={cn(FRAME, "group")}>
        <div className="divide-y">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
          {note && (
            <div className="mr-auto text-sm text-muted-foreground">{note}</div>
          )}
          <ConfirmSave risks={risks} disabled={disabled} />
        </div>
      </form>
    </section>
  )
}

export function SettingRow({
  id,
  label,
  htmlFor,
  hint,
  tip,
  warning,
  reset,
  stacked,
  children,
}: {
  // Anchor admin search jumps to.
  id: string
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  tip?: Tip
  // What can go wrong, shown under the hint.
  warning?: React.ReactNode
  // From resettable(); needs the row to sit inside a SettingsForm.
  reset?: { keys: SettingKey[]; modified: boolean }
  // Control below the text instead of beside it, for wide controls.
  stacked?: boolean
  children?: React.ReactNode
}) {
  const Label = htmlFor ? "label" : "span"
  return (
    <div
      id={id}
      className={cn(
        "grid scroll-mt-24 gap-3 px-4 py-4 first:rounded-t-xl last:rounded-b-xl",
        !stacked && "sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:gap-8"
      )}
    >
      <div className="grid content-start gap-1">
        <div className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-1">
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
          {tip && <InfoTip label={label} tip={tip} />}
          {reset?.modified && (
            <span className="ml-1 flex items-center gap-1.5">
              <Badge variant="secondary">Changed</Badge>
              <button
                formAction={resetSetting.bind(null, reset.keys)}
                formNoValidate
                className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Reset to default
              </button>
            </span>
          )}
        </div>
        {hint && (
          <p className="text-sm text-pretty text-muted-foreground">{hint}</p>
        )}
        {warning && (
          <p className="flex gap-1.5 text-sm text-pretty text-foreground/90">
            <WarningIcon
              weight="fill"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            <span>{warning}</span>
          </p>
        )}
      </div>
      {children && (
        <div
          className={cn(
            "flex min-w-0 flex-col gap-2",
            !stacked && "sm:items-stretch"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
