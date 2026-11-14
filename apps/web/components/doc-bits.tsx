import { cn } from "@/lib/utils"

// Small pieces the Documents page, the panel and search results share.

export const money = (amount: number | null, currency: string | null) =>
  amount === null
    ? ""
    : (() => {
        try {
          return new Intl.NumberFormat(
            undefined,
            currency
              ? { style: "currency", currency }
              : { minimumFractionDigits: 2 }
          ).format(amount)
        } catch {
          return `${amount.toFixed(2)} ${currency ?? ""}`.trim()
        }
      })()

// YYYY-MM-DD as a local date (new Date("2025-03-01") would shift a day west of UTC).
export const day = (d: string | null, long = false) =>
  d
    ? new Date(`${d}T12:00:00`).toLocaleDateString(
        undefined,
        long
          ? { dateStyle: "medium" }
          : { year: "numeric", month: "short", day: "numeric" }
      )
    : ""

export type DocInfo = {
  type: string | null
  sender: string | null
  amount: number | null
  currency: string | null
  date: string | null
}

// Type, sender and amount as chips after a result's name.
export function DocChips({
  info,
  className,
}: {
  info: DocInfo
  className?: string
}) {
  const parts = [
    info.type,
    info.sender,
    money(info.amount, info.currency),
  ].filter(Boolean) as string[]
  if (!parts.length) return null
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 max-sm:hidden",
        className
      )}
    >
      {parts.map((p, i) => (
        <span
          key={i}
          className="rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums"
        >
          {p}
        </span>
      ))}
    </span>
  )
}

// "In 5 days", "Today", "Expired 3 days ago".
export const expiryLabel = (daysLeft: number) =>
  daysLeft < 0
    ? `Expired ${-daysLeft} ${-daysLeft === 1 ? "day" : "days"} ago`
    : daysLeft === 0
      ? "Today"
      : daysLeft === 1
        ? "Tomorrow"
        : `In ${daysLeft} days`

// The date and its label: warning inside the window, destructive once past.
export function Expiry({
  date,
  daysLeft,
  remindDays,
  small,
}: {
  date: string | null
  daysLeft: number | null
  remindDays: number | null
  small?: boolean
}) {
  if (!date || daysLeft === null)
    return <span className="text-muted-foreground">·</span>
  const past = daysLeft < 0
  const soon = !past && daysLeft <= (remindDays ?? 30)
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span
        className={cn(
          "truncate tabular-nums",
          small ? "text-xs text-muted-foreground" : "text-sm"
        )}
      >
        {day(date)}
      </span>
      <span
        className={cn(
          "truncate text-xs",
          past
            ? "text-destructive"
            : soon
              ? "text-warning"
              : "text-muted-foreground"
        )}
      >
        {expiryLabel(daysLeft)}
      </span>
    </span>
  )
}
