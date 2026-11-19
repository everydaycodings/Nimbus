"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { setBucketCors } from "@/app/(app)/buckets/actions"
import { RuleDialog } from "@/components/buckets/rule-dialog"
import { Confirm, Heading, SECTION, TOUCH } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CorsRule } from "@/lib/s3api/bucket-config"
import { CORS_METHODS } from "@/lib/s3api/config-rules"

const ORIGIN = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean)
const commas = (s: string) => s.split(/[,\n]/).map((l) => l.trim()).filter(Boolean)

const TEMPLATE: Omit<CorsRule, "origins"> = {
  methods: ["GET", "HEAD", "PUT", "POST"],
  headers: ["*"],
  expose: ["ETag"],
  maxAgeSeconds: 3000,
}

export function SettingsCors({ bucketId, rules }: { bucketId: string; rules: CorsRule[] }) {
  const router = useRouter()
  const setNotice = useNotice()
  // index into rules, or rules.length for a new one
  const [editing, setEditing] = useState<{ at: number; rule: CorsRule | null; template?: boolean } | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  const save = (next: CorsRule[], done: string, ok?: () => void) =>
    start(async () => {
      setError(undefined)
      const r = await setBucketCors(bucketId, next)
      if (r.error) return setError(r.error)
      setNotice({ text: done })
      ok?.()
      router.refresh()
    })

  return (
    <section className={SECTION} aria-labelledby="cors-heading">
      <Heading
        id="cors-heading"
        title="CORS"
        hint="Lets web pages on these sites call this bucket from the browser. Without a rule, browsers block those calls."
      >
        <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={() => setEditing({ at: rules.length, rule: null })}>
          Add rule
        </Button>
      </Heading>
      {rules.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No CORS rules. Browsers can’t call this bucket.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={TOUCH}
            onClick={() => setEditing({ at: rules.length, rule: { origins: [], ...TEMPLATE }, template: true })}
          >
            Allow browser uploads from one site
          </Button>
        </div>
      ) : (
        <ul className="grid gap-2">
          {rules.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-mono text-sm break-all">{r.origins.join(", ")}</p>
                <p className="text-sm text-muted-foreground">
                  {r.methods.join(", ")} · cached {r.maxAgeSeconds} s
                  {r.headers.length > 0 && ` · headers: ${r.headers.join(", ")}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className={TOUCH} disabled={pending} onClick={() => setEditing({ at: i, rule: r })}>
                  Edit
                </Button>
                <Confirm
                  label="Delete"
                  ariaLabel={`Delete CORS rule for ${r.origins.join(", ")}`}
                  question="Delete this rule?"
                  yes="Delete rule"
                  pending={pending}
                  onYes={() => save(rules.filter((_, j) => j !== i), "Deleted the rule.")}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!editing && <FormError>{error}</FormError>}
      {editing && (
        <CorsDialog
          rule={editing.rule}
          template={editing.template}
          pending={pending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(rule) => save(rules.toSpliced(editing.at, editing.at < rules.length ? 1 : 0, rule), "Saved the rule.", () => setEditing(null))}
        />
      )}
    </section>
  )
}

function CorsDialog({
  rule,
  template,
  pending,
  error,
  onSave,
  onClose,
}: {
  rule: CorsRule | null
  template?: boolean
  pending: boolean
  error?: string
  onSave: (r: CorsRule) => void
  onClose: () => void
}) {
  const id = useId()
  const [origins, setOrigins] = useState(rule?.origins.join("\n") ?? "")
  const [methods, setMethods] = useState<CorsRule["methods"]>(rule?.methods ?? ["GET", "HEAD"])
  const [headers, setHeaders] = useState(rule?.headers.join(", ") ?? "")
  const [expose, setExpose] = useState(rule?.expose.join(", ") ?? "")
  const [age, setAge] = useState(String(rule?.maxAgeSeconds ?? 3000))
  const list = lines(origins)
  const badOrigins = list.filter((o) => o !== "*" && !ORIGIN.test(o))
  const originHint = list.length === 0 ? "Add at least one origin." : badOrigins.length ? `Not a valid origin: ${badOrigins.join(", ")}. Use https://example.com or *.` : null
  const ageN = Number(age)
  const ageBad = !(Number.isInteger(ageN) && ageN >= 0 && ageN <= 86400)
  const invalid = Boolean(originHint) || methods.length === 0 || ageBad

  return (
    <RuleDialog
      title={rule && !template ? "Edit CORS rule" : "Add CORS rule"}
      description="Origins are the sites allowed to call this bucket. The browser checks them, so only the site address matters."
      pending={pending}
      error={error}
      disabled={invalid}
      onClose={onClose}
      onSubmit={() =>
        onSave({ origins: list, methods, headers: commas(headers), expose: commas(expose), maxAgeSeconds: ageN })
      }
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-origins`}>Allowed origins, one per line</Label>
        <textarea
          id={`${id}-origins`}
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          rows={3}
          placeholder="https://app.example.com"
          autoComplete="off"
          spellCheck={false}
          autoFocus={template}
          aria-invalid={originHint && origins ? true : undefined}
          aria-describedby={`${id}-origins-hint`}
          className="w-full rounded-md border border-input bg-input/30 px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p id={`${id}-origins-hint`} className={originHint && origins ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {originHint && origins ? originHint : "Like https://app.example.com or http://localhost:3000. * allows every site."}
        </p>
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Allowed methods</legend>
        <div className="flex flex-wrap gap-x-4">
          {CORS_METHODS.map((m) => (
            <label key={m} className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={methods.includes(m)}
                onChange={(e) => setMethods(CORS_METHODS.filter((x) => (x === m ? e.target.checked : methods.includes(x))))}
              />
              {m}
            </label>
          ))}
        </div>
        {methods.length === 0 && <p className="text-sm text-destructive">Pick at least one method.</p>}
      </fieldset>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-headers`}>Allowed headers</Label>
        <Input id={`${id}-headers`} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="*" autoComplete="off" spellCheck={false} className="font-mono" />
        <p className="text-sm text-muted-foreground">Request headers the page may send, separated by commas. * allows any.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-expose`}>Exposed headers</Label>
        <Input id={`${id}-expose`} value={expose} onChange={(e) => setExpose(e.target.value)} placeholder="ETag" autoComplete="off" spellCheck={false} className="font-mono" />
        <p className="text-sm text-muted-foreground">Response headers the page may read, like ETag (needed for multipart uploads).</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-age`}>Cache the answer for (seconds)</Label>
        <Input
          id={`${id}-age`}
          type="number"
          min={0}
          max={86400}
          step={1}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          aria-invalid={ageBad || undefined}
          className="w-32"
        />
        {ageBad && <p className="text-sm text-destructive">Enter a whole number from 0 to 86400.</p>}
      </div>
    </RuleDialog>
  )
}
