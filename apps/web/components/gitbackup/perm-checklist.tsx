import { ArrowSquareOutIcon, CheckCircleIcon, MinusCircleIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react"

import type { Perm } from "@/lib/gitbackup/perms"
import type { Provider } from "@/lib/gitbackup/refs"
import { PROVIDERS } from "./providers"

// What a token check found: each permission with its state in words (never colour alone), and, when
// something is missing, what to change. Only a one-line count is live, so a screen reader hears the result without the whole list.
export function PermChecklist({ provider, checks, fix, note, link }: { provider: Provider; checks: Perm[]; fix?: string; note?: string; link?: string }) {
  const P = PROVIDERS[provider]
  const why = (p: Perm) => p.why ?? [...P.need, ...P.push].find((x) => x.name === p.name)?.why
  const n = (f: (p: Perm) => boolean) => checks.filter(f).length
  const summary = [
    [n((p) => p.ok === true), "granted"],
    [n((p) => p.ok === false && p.required), "missing"],
    [n((p) => p.ok === false && !p.required), "optional not granted"],
    [n((p) => p.ok === null), "can't tell"],
  ].filter(([c]) => c).map(([c, w]) => `${c} ${w}`).join(", ")
  return (
    <div className="grid gap-2 text-sm">
      <p role="status" className="sr-only">Permissions checked: {summary}.</p>
      <ul aria-label="Token permissions" className="divide-y rounded-lg border">
        {checks.map((p) => (
          <li key={p.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
            <State p={p} />
            <span className="font-mono text-xs">{p.name}</span>
            <span className="text-pretty text-muted-foreground">
              {p.required ? "" : "Optional: "}
              {why(p)}
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="text-pretty text-muted-foreground">{note}</p>}
      {fix && (
        <p className="text-pretty">
          {fix}{" "}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {P.linkText}
              <ArrowSquareOutIcon aria-hidden className="size-3.5" />
            </a>
          )}
        </p>
      )}
    </div>
  )
}

function State({ p }: { p: Perm }) {
  const base = "inline-flex w-28 shrink-0 items-center gap-1.5 text-xs"
  if (p.ok === true)
    return (
      <span className={`${base} text-muted-foreground`}>
        <CheckCircleIcon aria-hidden className="size-4 text-brand" />
        Granted
      </span>
    )
  if (p.ok === null)
    return (
      <span className={`${base} text-muted-foreground`}>
        <MinusCircleIcon aria-hidden className="size-4" />
        Can&apos;t tell
      </span>
    )
  return p.required ? (
    <span className={`${base} font-medium text-destructive`}>
      <XCircleIcon aria-hidden className="size-4" />
      Missing
    </span>
  ) : (
    <span className={`${base} text-muted-foreground`}>
      <WarningIcon aria-hidden className="size-4 text-warning" />
      Not granted
    </span>
  )
}
