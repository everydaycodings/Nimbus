"use client"

import { CheckCircleIcon, QuestionIcon, XCircleIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import {
  namespaceImagePolicy,
  previewImagePolicy,
  saveImagePolicy,
  type PolicyPreview,
} from "@/app/(app)/registry/actions"
import { reasonOf } from "@/components/registry-links"
import { Confirm, Heading, LIST, SECTION, Switch, TOUCH } from "@/components/registry-ui"
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
  unscannedFails?: boolean
}
// unknown: the fact isn't known yet (not scanned, no package list). Never shown as a pass.
export type CheckState = "pass" | "fail" | "unknown"
export type Check = {
  key: string
  label: string
  state: CheckState
  detail: string
}
export type Verdict = { verdict: CheckState; checks: Check[] }

const STATE_WORD = { pass: "Passes", fail: "Fails", unknown: "Not checked" } as const

// Passes, Fails or Not checked. Not checked is never green: the facts aren't known yet.
export function PolicyBadge({ v }: { v: Verdict | null | undefined }) {
  if (!v) return null
  const why = reasonOf(v)
  return (
    <Badge
      variant="outline"
      title={why}
      aria-label={`Policy: ${v.verdict === "unknown" ? "not checked" : v.verdict === "pass" ? "passes" : "fails"}. ${why}`}
      className={cn(
        v.verdict === "unknown" && "border-dashed text-muted-foreground"
      )}
    >
      {v.verdict === "pass" ? (
        <CheckCircleIcon className="text-brand" />
      ) : v.verdict === "fail" ? (
        <XCircleIcon className="text-destructive" />
      ) : (
        <QuestionIcon />
      )}
      {v.verdict === "unknown" ? "Not checked" : v.verdict === "pass" ? "Passes policy" : "Fails policy"}
    </Badge>
  )
}

// One line per check, a mark and words, never the mark alone.
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-md border text-sm">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 px-3 py-2">
          {c.state === "pass" ? (
            <CheckCircleIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-brand"
            />
          ) : c.state === "fail" ? (
            <XCircleIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
          ) : (
            <QuestionIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{c.label}</span>
            <span className="block text-xs text-pretty text-muted-foreground">
              <span className="sr-only">{STATE_WORD[c.state]}. </span>
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
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // Where focus goes once the list has re-rendered after a remove.
  const after = useRef<number | null>(null)
  const sug = useId()
  useEffect(() => {
    if (after.current === null) return
    const btns = list.current?.querySelectorAll<HTMLElement>("button")
    const i = after.current
    after.current = null
    ;(btns?.[Math.min(i, btns.length - 1)] ?? input.current)?.focus()
  }, [value])
  const add = (raw: string, refocus = true) => {
    const v = raw.trim()
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase()))
      onChange([...value, v])
    setText("")
    if (refocus) input.current?.focus()
  }
  const left = SUGGEST.filter((s) => !value.includes(s))
  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul
          ref={list}
          className="flex flex-wrap gap-1.5"
          aria-label="Blocked licenses"
        >
          {value.map((l, i) => (
            <li key={l}>
              <Badge variant="outline" className="gap-1 pr-0.5 font-mono">
                {l}
                <button
                  type="button"
                  aria-label={`Remove ${l}`}
                  onClick={() => {
                    after.current = i
                    onChange(value.filter((x) => x !== l))
                  }}
                  className="grid size-6 place-items-center rounded-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        ref={input}
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
        onBlur={() => add(text, false)}
        placeholder="SPDX id, then Enter"
        className="font-mono"
      />
      {left.length > 0 && (
        <div
          role="group"
          aria-labelledby={sug}
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span id={sug}>Suggestions</span>
          {left.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Add ${s}`}
              onClick={() => add(s)}
              className="inline-flex h-6 items-center rounded-md border px-2 font-mono outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:px-3"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// What a policy says about the newest tag of each repository in the name. The wording is the same everywhere.
export const SCOPE = "the newest tag of each repository"

export function PolicyPreviewList({
  p,
  draft,
}: {
  p: PolicyPreview
  draft?: boolean
}) {
  if (p.total === 0)
    return (
      <p className="text-xs text-muted-foreground">
        There are no tags here yet to check.
      </p>
    )
  return (
    <div className="grid gap-1.5 rounded-md border px-3 py-2 text-sm">
      <p className="font-medium tabular-nums">
        {draft ? "With these rules, " : "Right now, "}
        {p.failing.length} of {p.total}{" "}
        {p.total === 1 ? "repository fails" : "repositories fail"}
        <span className="font-normal text-muted-foreground">
          {" "}
          (judged by {SCOPE})
        </span>
      </p>
      {p.unknown > 0 && (
        <p className="text-xs text-muted-foreground">
          {p.unknown} could not be fully checked yet, for example because they
          aren&apos;t scanned.
        </p>
      )}
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

const EMPTY = {
  maxCritical: "",
  maxHigh: "",
  maxAgeDays: "",
  requireSigned: false,
  blockedLicenses: [] as string[],
  blockPulls: false,
  unscannedFails: false,
}

// Owners only: the rules every image in a registry name is held to.
export function ImagePolicyEditor({ namespace }: { namespace: string }) {
  const id = useId()
  const setNotice = useNotice()
  const [loaded, setLoaded] = useState<ImagePolicy | null | undefined>(
    undefined
  )
  const [f, setF] = useState(EMPTY)
  const [saved, setSaved] = useState("")
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<{
    p: PolicyPreview
    draft: boolean
  } | null>(null)
  const [pending, start] = useTransition()
  const [askBlock, setAskBlock] = useState(false)
  const keepBlock = useRef<HTMLButtonElement>(null)
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
        unscannedFails: Boolean(p?.unscannedFails),
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
  useEffect(() => {
    if (askBlock) keepBlock.current?.focus()
  }, [askBlock])
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
    unscannedFails: f.unscannedFails,
  })
  // Checks the draft as it is on screen, saved or not. aria-disabled, not disabled, so focus stays on the button.
  const check = () => {
    if (pending) return
    start(async () => {
      const p = await previewImagePolicy(namespace, toPolicy())
      setPreview(p && { p, draft: dirty })
    })
  }
  const hasScanLimit = f.maxCritical !== "" || f.maxHigh !== ""
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (pending) return
        setError(undefined)
        start(async () => {
          const r = await saveImagePolicy(namespace, toPolicy())
          if (r.error) return setError(r.error)
          setSaved(JSON.stringify(f))
          setLoaded(toPolicy())
          setNotice({ text: "Image policy saved." })
          const p = await previewImagePolicy(namespace, toPolicy())
          setPreview(p && { p, draft: false })
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
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <Switch
          className="mt-0.5"
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
          checked={f.unscannedFails}
          disabled={!hasScanLimit}
          onChange={(e) => setF({ ...f, unscannedFails: e.target.checked })}
        />
        <span className="grid gap-0.5">
          <span className="font-medium">
            Treat images that aren&apos;t scanned yet as failing
          </span>
          <span className="text-xs text-pretty text-muted-foreground">
            {hasScanLimit
              ? "Off: an image with no scan shows Not checked and still pulls. On: it fails the vulnerability limits until its scan finishes."
              : "Needs a critical or high limit above."}
          </span>
        </span>
      </label>
      <div className="grid gap-2">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Switch
            className="mt-0.5"
            checked={f.blockPulls || askBlock}
            onChange={(e) => {
              if (e.target.checked) setAskBlock(true)
              else setF({ ...f, blockPulls: false })
            }}
          />
          <span className="grid gap-0.5">
            <span className="font-medium">Block pulls of images that fail</span>
            <span className="text-xs text-pretty text-muted-foreground">
              <code className="font-mono">docker pull</code> is refused for any
              image that fails, for everyone including you.
              {f.unscannedFails && " Images not scanned yet are refused too."}
            </span>
          </span>
        </label>
        {askBlock && (
          <div
            role="group"
            aria-label="Confirm blocking pulls"
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <p className="min-w-0 flex-1 basis-60 text-pretty">
              Your CI and deploys that pull a failing image will stop working
              until it passes or you turn this off.
              {f.unscannedFails
                ? " That includes new images until their first scan finishes."
                : ""}
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className={TOUCH}
              onClick={() => {
                setF({ ...f, blockPulls: true })
                setAskBlock(false)
              }}
            >
              Turn on blocking
            </Button>
            <Button
              ref={keepBlock}
              type="button"
              variant="ghost"
              size="sm"
              className={TOUCH}
              onClick={() => setAskBlock(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending} className={TOUCH}>
          Save image policy
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          className={cn(
            TOUCH,
            "aria-disabled:pointer-events-none aria-disabled:opacity-50"
          )}
          aria-disabled={pending || undefined}
          onClick={check}
        >
          Check tags
        </Button>
        {loaded && (
          <Confirm
            label="Remove policy"
            question="Images stop being checked and pulls are no longer blocked."
            yes="Remove"
            pending={pending}
            danger={false}
            onYes={() =>
              start(async () => {
                const r = await saveImagePolicy(namespace, null)
                if (r.error) return setError(r.error)
                setF(EMPTY)
                setSaved(JSON.stringify(EMPTY))
                setLoaded(null)
                setPreview(null)
                setNotice({ text: "Image policy removed." })
              })
            }
          />
        )}
        <span className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes. " : ""}
          Check tags tests {dirty ? "these rules" : "the saved rules"} on{" "}
          {SCOPE}, without saving.
        </span>
      </div>
      <FormError>{error}</FormError>
      <div role="status">
        {preview && <PolicyPreviewList p={preview.p} draft={preview.draft} />}
      </div>
    </form>
  )
}

// The Access tab's section: one editor per registry name the member owns. Repos link here with #policy-<name>.
export function ImagePolicySection({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <section className={SECTION} aria-labelledby="policy-heading">
      <Heading
        id="policy-heading"
        title="Image policy"
        hint="Rules every image under a registry name is held to: vulnerability limits, age, signing and licenses. Each tag shows Passes, Fails or Not checked."
      />
      <ul className={LIST}>
        {names.map((n) => (
          <li key={n} id={`policy-${n}`} className="grid scroll-mt-20 gap-3 px-4 py-4">
            <h3 className="font-mono text-sm font-medium break-all">{n}</h3>
            <ImagePolicyEditor namespace={n} />
          </li>
        ))}
      </ul>
    </section>
  )
}
