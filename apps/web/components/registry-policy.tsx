"use client"

import { CheckCircleIcon, XCircleIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useId, useState, useTransition } from "react"

import {
  namespaceImagePolicy,
  previewImagePolicy,
  saveImagePolicy,
  type PolicyPreview,
} from "@/app/(app)/registry/actions"
import { Switch, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type ImagePolicy = {
  maxCritical?: number | null
  maxHigh?: number | null
  maxAgeDays?: number | null
  requireSigned?: boolean
  blockedLicenses?: string[]
  blockPulls?: boolean
}
export type Check = {
  key: string
  label: string
  pass: boolean
  detail: string
}
export type Verdict = { pass: boolean; checks: Check[] }

// Pass or fail in a tag row; the first failing check is the tooltip and the screen reader text.
export function PolicyBadge({ v }: { v: Verdict | null | undefined }) {
  if (!v) return null
  const bad = v.checks.find((c) => !c.pass)
  const why = bad ? `${bad.label}: ${bad.detail}` : "Meets the image policy"
  return (
    <Badge
      variant="outline"
      title={why}
      aria-label={v.pass ? "Policy: passes" : `Policy: fails. ${why}`}
    >
      {v.pass ? (
        <CheckCircleIcon className="text-brand" />
      ) : (
        <XCircleIcon className="text-destructive" />
      )}
      {v.pass ? "Passes policy" : "Fails policy"}
    </Badge>
  )
}

// One line per check, a mark and words, never the mark alone.
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-md border text-sm">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 px-3 py-2">
          {c.pass ? (
            <CheckCircleIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-brand"
            />
          ) : (
            <XCircleIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{c.label}</span>
            <span className="block text-xs text-pretty text-muted-foreground">
              <span className="sr-only">{c.pass ? "Passes. " : "Fails. "}</span>
              {c.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

const SUGGEST = [
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "LGPL-3.0",
  "SSPL-1.0",
  "CC-BY-NC-4.0",
]
const num = (v: number | null | undefined) => (v == null ? "" : String(v))

function Licenses({
  id,
  value,
  onChange,
}: {
  id: string
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [text, setText] = useState("")
  const add = (raw: string) => {
    const v = raw.trim()
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase()))
      onChange([...value, v])
    setText("")
  }
  const left = SUGGEST.filter((s) => !value.includes(s))
  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Blocked licenses">
          {value.map((l) => (
            <li key={l}>
              <Badge variant="outline" className="gap-1 pr-1 font-mono">
                {l}
                <button
                  type="button"
                  aria-label={`Remove ${l}`}
                  onClick={() => onChange(value.filter((x) => x !== l))}
                  className="grid size-5 place-items-center rounded-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-8"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            add(text)
          } else if (e.key === "Backspace" && !text && value.length)
            onChange(value.slice(0, -1))
        }}
        onBlur={() => add(text)}
        placeholder="SPDX id, then Enter"
        className="font-mono"
      />
      {left.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Suggestions
          {left.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex h-6 items-center rounded-md border px-2 font-mono outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-9"
            >
              {s}
            </button>
          ))}
        </p>
      )}
    </div>
  )
}

export function PolicyPreviewList({ p }: { p: PolicyPreview }) {
  if (p.total === 0)
    return (
      <p className="text-xs text-muted-foreground">
        There are no tags here yet to check.
      </p>
    )
  return (
    <div
      role="status"
      className="grid gap-1.5 rounded-md border px-3 py-2 text-sm"
    >
      <p className="font-medium tabular-nums">
        Today {p.failing.length} of {p.total}{" "}
        {p.total === 1
          ? "repository's newest tag"
          : "repositories' newest tags"}{" "}
        would fail
      </p>
      {p.failing.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {p.failing.slice(0, 8).map((f) => (
            <li key={f.repo} className="break-words">
              <span className="font-mono text-foreground">
                {f.repo}:{f.tag}
              </span>{" "}
              {f.reason}
            </li>
          ))}
          {p.failing.length > 8 && <li>and {p.failing.length - 8} more</li>}
        </ul>
      )}
    </div>
  )
}

// Owners only: the rules every image in a registry name is held to.
export function ImagePolicyEditor({ namespace }: { namespace: string }) {
  const id = useId()
  const setNotice = useNotice()
  const [loaded, setLoaded] = useState<ImagePolicy | null | undefined>(
    undefined
  )
  const [f, setF] = useState({
    maxCritical: "",
    maxHigh: "",
    maxAgeDays: "",
    requireSigned: false,
    blockedLicenses: [] as string[],
    blockPulls: false,
  })
  const [saved, setSaved] = useState("")
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<PolicyPreview | null>(null)
  const [pending, start] = useTransition()
  useEffect(() => {
    namespaceImagePolicy(namespace).then((p) => {
      setLoaded(p)
      const next = {
        maxCritical: num(p?.maxCritical),
        maxHigh: num(p?.maxHigh),
        maxAgeDays: num(p?.maxAgeDays),
        requireSigned: Boolean(p?.requireSigned),
        blockedLicenses: p?.blockedLicenses ?? [],
        blockPulls: Boolean(p?.blockPulls),
      }
      setF(next)
      setSaved(JSON.stringify(next))
    })
  }, [namespace])
  const dirty = JSON.stringify(f) !== saved
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  if (loaded === undefined)
    return <p className="py-4 text-sm text-muted-foreground">Loading…</p>
  const set =
    (k: "maxCritical" | "maxHigh" | "maxAgeDays") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setF({ ...f, [k]: e.target.value })
  const toPolicy = (): ImagePolicy => ({
    maxCritical: f.maxCritical === "" ? null : Number(f.maxCritical),
    maxHigh: f.maxHigh === "" ? null : Number(f.maxHigh),
    maxAgeDays: f.maxAgeDays === "" ? null : Number(f.maxAgeDays),
    requireSigned: f.requireSigned,
    blockedLicenses: f.blockedLicenses,
    blockPulls: f.blockPulls,
  })
  const check = () =>
    start(async () => {
      setPreview(await previewImagePolicy(namespace))
    })
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(undefined)
        start(async () => {
          const r = await saveImagePolicy(namespace, toPolicy())
          if (r.error) return setError(r.error)
          setSaved(JSON.stringify(f))
          setNotice({ text: "Image policy saved." })
          setPreview(await previewImagePolicy(namespace))
        })
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-c`}>Max critical vulnerabilities</Label>
          <Input
            id={`${id}-c`}
            type="number"
            min={0}
            value={f.maxCritical}
            onChange={set("maxCritical")}
            placeholder="No limit"
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-h`}>Max high vulnerabilities</Label>
          <Input
            id={`${id}-h`}
            type="number"
            min={0}
            value={f.maxHigh}
            onChange={set("maxHigh")}
            placeholder="No limit"
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-a`}>Max image age (days)</Label>
          <Input
            id={`${id}-a`}
            type="number"
            min={1}
            value={f.maxAgeDays}
            onChange={set("maxAgeDays")}
            placeholder="No limit"
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-l`}>Blocked licenses</Label>
        <Licenses
          id={`${id}-l`}
          value={f.blockedLicenses}
          onChange={(v) => setF({ ...f, blockedLicenses: v })}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <Switch
          checked={f.requireSigned}
          onChange={(e) => setF({ ...f, requireSigned: e.target.checked })}
        />
        <span className="grid">
          <span className="font-medium">Require signed images</span>
          <span className="text-xs text-muted-foreground">
            Images without a cosign signature fail.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <Switch
          className="mt-0.5"
          checked={f.blockPulls}
          onChange={(e) => setF({ ...f, blockPulls: e.target.checked })}
        />
        <span className="grid gap-0.5">
          <span className="font-medium">Block pulls of images that fail</span>
          <span className="text-xs text-pretty text-muted-foreground">
            <code className="font-mono">docker pull</code> will be refused for
            any image that fails, for everyone including you. Your CI and
            deploys that pull it may fail.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} className={TOUCH}>
          Save image policy
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          className={TOUCH}
          disabled={pending || dirty}
          onClick={check}
        >
          Check tags
        </Button>
        {loaded && (
          <Button
            type="button"
            variant="ghost"
            className={cn(TOUCH, "text-muted-foreground")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveImagePolicy(namespace, null)
                if (r.error) return setError(r.error)
                const empty = {
                  maxCritical: "",
                  maxHigh: "",
                  maxAgeDays: "",
                  requireSigned: false,
                  blockedLicenses: [],
                  blockPulls: false,
                }
                setF(empty)
                setSaved(JSON.stringify(empty))
                setLoaded(null)
                setPreview(null)
                setNotice({ text: "Image policy removed." })
              })
            }
          >
            Remove policy
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {dirty
            ? "Save first. Check tags uses the saved policy."
            : "Checks the newest tag of each repository."}
        </span>
      </div>
      <FormError>{error}</FormError>
      {preview && <PolicyPreviewList p={preview} />}
    </form>
  )
}

// Read-only on a repo's Overview: how the newest tags do, and the checks for the newest one.
export function PolicyPanel({
  tag,
  verdict,
  failing,
  total,
  blocking,
}: {
  tag: string
  verdict: Verdict
  failing: number
  total: number
  blocking: boolean
}) {
  return (
    <div className="grid gap-3">
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="tabular-nums">
          {failing === 0
            ? `All ${total} checked ${total === 1 ? "tag passes" : "tags pass"}`
            : `${failing} of ${total} checked ${total === 1 ? "tag fails" : "tags fail"}`}
        </span>
        {blocking && (
          <span className="text-xs text-muted-foreground">
            Pulls of failing images are blocked.
          </span>
        )}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Newest tag <span className="font-mono">{tag}</span>
        </span>
        <PolicyBadge v={verdict} />
      </p>
      <CheckList checks={verdict.checks} />
    </div>
  )
}
