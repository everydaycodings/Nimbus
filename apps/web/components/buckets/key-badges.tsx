import { ClockCountdownIcon, PauseCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

import { Badge } from "@/components/ui/badge"
import type { KeyRow } from "@/lib/s3api/manage"

const WHEN = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

type State = Pick<KeyRow, "disabled" | "expired" | "rotationDue" | "expiringSoon" | "oldSecretUntil">

// The states worth a glance. Each says it in words as well as colour.
export function KeyBadges({ k }: { k: State }) {
  if (!(k.disabled || k.expired || k.rotationDue || k.expiringSoon || k.oldSecretUntil)) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {k.disabled && (
        <Badge variant="secondary">
          <PauseCircleIcon aria-hidden />
          Disabled
        </Badge>
      )}
      {k.expired && <Badge variant="secondary">Expired</Badge>}
      {k.rotationDue && (
        <Badge variant="outline" className="text-warning">
          <WarningIcon aria-hidden weight="fill" />
          Rotation due
        </Badge>
      )}
      {k.expiringSoon && (
        <Badge variant="outline" className="text-warning">
          <ClockCountdownIcon aria-hidden />
          Expiring soon
        </Badge>
      )}
      {k.oldSecretUntil && (
        <Badge variant="outline" suppressHydrationWarning title="After a rotation, the old secret keeps working until then.">
          <ClockCountdownIcon aria-hidden />
          Old secret until {WHEN.format(new Date(k.oldSecretUntil))}
        </Badge>
      )}
    </span>
  )
}
