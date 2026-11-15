"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsLeftRightIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { Delta } from "@/components/registry-advice"
import type { Pkg } from "@/components/registry-packages"
import { VulnList, type Counts, type Vuln } from "@/components/registry-scan"
import { compareHref } from "@/components/registry-links"
import { Heading, SECTION, SELECT, TOUCH, WHEN, useLate } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sizeOf } from "@/lib/registry/size"
import { cn } from "@/lib/utils"

type Side = {
  ref: string
  digest: string
  size: number
  pushedAt: string | null
  platform: string | null
}
export type CompareData = {
  a: Side
  b: Side
  scanned: { a: boolean; b: boolean }
  packages: {
    added: Pkg[]
    removed: Pkg[]
    changed: { name: string; type: string; from: string; to: string }[]
  }
  vulns: { fixed: Vuln[]; introduced: Vuln[]; counts: { a: Counts; b: Counts } }
  layers: {
    shared: number
    onlyA: number
    onlyB: number
    sizeA: number
    sizeB: number
  }
}

const PAGE = 50
const short = (d: string) => `${d.slice(0, 19)}…`

// Splits "1.10.2-r3" into numbers and words and compares piece by piece: good enough to tell up from down.
function cmpVersion(a: string, b: string) {
  const x = a.split(/[^0-9a-zA-Z]+/)
  const y = b.split(/[^0-9a-zA-Z]+/)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? "0"
    const q = y[i] ?? "0"
    const n =
      /^\d+$/.test(p) && /^\d+$/.test(q)
        ? Number(p) - Number(q)
        : p.localeCompare(q)
    if (n) return n
  }
  return 0
}

function Picker({
  label,
  side,
  tags,
  onPick,
}: {
  label: string
  side: Side
  tags: { name: string; digest: string }[]
  onPick: (ref: string) => void
}) {
  const known = tags.some((t) => t.name === side.ref)
  return (
    <div className="grid min-w-0 content-start gap-2 rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <select
        aria-label={`${label} image`}
        value={side.ref}
        onChange={(e) => onPick(e.target.value)}
        className={cn(SELECT, "w-full font-mono pointer-coarse:h-11")}
      >
        {!known && <option value={side.ref}>{short(side.ref)}</option>}
        {tags.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Digest</dt>
        <dd className="truncate font-mono" title={side.digest}>
          {short(side.digest)}
        </dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">{sizeOf(side.size)}</dd>
        <dt className="text-muted-foreground">Pushed</dt>
        <dd suppressHydrationWarning>
          {side.pushedAt ? WHEN.format(new Date(side.pushedAt)) : "—"}
        </dd>
        <dt className="text-muted-foreground">Platform</dt>
        <dd className="font-mono">{side.platform ?? "—"}</dd>
      </dl>
    </div>
  )
}

function Stat({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-w-0 content-start gap-1 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="grid min-w-0 gap-1 text-sm font-medium tabular-nums">
        {children}
      </dd>
    </div>
  )
}

function More({
  shown,
  total,
  onMore,
}: {
  shown: number
  total: number
  onMore: () => void
}) {
  return total > shown ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(TOUCH, "w-fit")}
      onClick={onMore}
    >
      Show {Math.min(PAGE * 4, total - shown)} more of {total - shown}
    </Button>
  ) : null
}

const ROW = "grid items-baseline gap-x-3 gap-y-0.5 px-4 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_6rem]"
// The small label shown in front of a value on a narrow screen, where the column headers are hidden (but still read).
const Lbl = ({ children }: { children: string }) => <span className="mr-1 text-muted-foreground sm:hidden">{children}</span>

// Added, removed and changed packages share one table shape so their columns line up.
function DiffTable({ label, heads, children }: { label: string; heads: [string, string, string]; children: React.ReactNode }) {
  return (
    <div role="table" aria-label={label} className="overflow-hidden rounded-xl border bg-card text-xs">
      <div role="rowgroup" className="max-sm:sr-only">
        <div role="row" className={cn(ROW, "text-muted-foreground")}>
          {heads.map((h) => (
            <span key={h} role="columnheader">
              {h}
            </span>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="divide-y border-t">
        {children}
      </div>
    </div>
  )
}

function PkgRows({ rows, kind }: { rows: Pkg[]; kind: "added" | "removed" }) {
  const [n, setN] = useState(PAGE)
  return (
    <div className="grid gap-2">
      <DiffTable label={kind === "added" ? "Added packages" : "Removed packages"} heads={["Package", "Version", "Type"]}>
        {rows.slice(0, n).map((p, i) => (
          <div role="row" key={`${p.type}-${p.name}-${p.version}-${i}`} className={ROW}>
            <span role="cell" className="font-mono text-sm break-all">
              <span aria-hidden className="mr-2 text-muted-foreground">
                {kind === "added" ? "+" : "−"}
              </span>
              {p.name}
            </span>
            <span role="cell" className="font-mono break-all text-muted-foreground">
              <Lbl>Version</Lbl>
              {p.version || "—"}
            </span>
            <span role="cell" className="text-muted-foreground">
              <Lbl>Type</Lbl>
              {p.type}
            </span>
          </div>
        ))}
      </DiffTable>
      <More shown={n} total={rows.length} onMore={() => setN(n + PAGE * 4)} />
    </div>
  )
}

export function CompareView({
  name,
  data,
  tags,
  canWrite,
}: {
  name: string
  data: CompareData
  tags: { name: string; digest: string }[]
  canWrite: boolean
}) {
  const router = useRouter()
  const { a, b, packages, vulns, layers } = data
  const go = (x: string, y: string) =>
    router.push(compareHref(name, x, y), { scroll: false })
  const [q, setQ] = useState("")
  const [type, setType] = useState("")
  const [nChanged, setNChanged] = useState(PAGE)
  const f = (p: { name: string; type: string }) =>
    (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())) &&
    (!type || p.type === type)
  const types = useMemo(
    () =>
      [
        ...new Set(
          [...packages.added, ...packages.removed, ...packages.changed].map(
            (p) => p.type
          )
        ),
      ].sort(),
    [packages]
  )
  const added = packages.added.filter(f)
  const removed = packages.removed.filter(f)
  const changed = packages.changed.filter(f)
  const sameMsg = useLate(a.digest === b.digest ? "These are the same image, so there is nothing to compare." : "")
  const size = b.size - a.size
  const tot =
    packages.added.length + packages.removed.length + packages.changed.length
  const scanNote = !data.scanned.a || !data.scanned.b
  const ok = (c: Counts) => ({ status: "done" as const, ...c })
  return (
    <div className="flex flex-col gap-8">
      <section
        aria-label="Images being compared"
        className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
      >
        <Picker
          label="From"
          side={a}
          tags={tags}
          onPick={(r) => go(r, b.ref)}
        />
        <div className="flex items-center justify-center">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Swap the two images"
            className="pointer-coarse:size-11"
            onClick={() => go(b.ref, a.ref)}
          >
            <ArrowsLeftRightIcon className="max-md:rotate-90" />
          </Button>
        </div>
        <Picker label="To" side={b} tags={tags} onPick={(r) => go(a.ref, r)} />
      </section>

      <div role="status">
        {sameMsg && (
          <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
            {sameMsg}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        <Stat label="Packages">
          <span>
            +{packages.added.length} −{packages.removed.length} ~
            {packages.changed.length}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            added, removed, changed
          </span>
        </Stat>
        <Stat label="Vulnerabilities">
          {scanNote ? (
            <span className="text-xs font-normal text-muted-foreground">
              {!data.scanned.a && !data.scanned.b
                ? "Neither image is scanned"
                : `${data.scanned.a ? b.ref : a.ref} isn't scanned`}
            </span>
          ) : (
            <>
              <span>
                {vulns.fixed.length} fixed · {vulns.introduced.length} new
              </span>
              <span className="text-xs font-normal">
                <Delta from={vulns.counts.a} to={vulns.counts.b} />
              </span>
            </>
          )}
        </Stat>
        <Stat label="Size">
          <span>
            {size === 0
              ? "No change"
              : `${size > 0 ? "+" : "−"}${sizeOf(Math.abs(size))}`}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {sizeOf(a.size)} → {sizeOf(b.size)}
          </span>
        </Stat>
        <Stat label="Layers">
          <span>{layers.shared} shared</span>
          <span className="text-xs font-normal text-muted-foreground">
            {layers.onlyA} only in {a.ref}, {layers.onlyB} only in {b.ref}
          </span>
        </Stat>
      </dl>

      <section className={SECTION} aria-labelledby="cmp-vulns">
        <Heading
          id="cmp-vulns"
          title="Vulnerabilities"
          hint={
            scanNote
              ? "Scan both images to compare their vulnerabilities."
              : `What moving from ${a.ref} to ${b.ref} fixes and what it adds.`
          }
        />
        {!scanNote && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <VulnList
              tag={a.ref}
              name={name}
              level={3}
              filterLabel="Filter fixed by severity"
              trimEmpty
              summary={ok(vulns.counts.a)}
              vulns={vulns.fixed}
              error={null}
              canRescan={false}
              title={`Fixed (${vulns.fixed.length})`}
              empty="No vulnerabilities fixed."
            />
            <VulnList
              tag={b.ref}
              name={name}
              level={3}
              filterLabel="Filter new by severity"
              trimEmpty
              summary={ok(vulns.counts.b)}
              vulns={vulns.introduced}
              error={null}
              canRescan={false}
              title={`New (${vulns.introduced.length})`}
              empty="No new vulnerabilities."
            />
          </div>
        )}
        {scanNote && canWrite && (
          <Link
            href={`/registry/${name}?tab=tags`}
            className="w-fit text-sm underline underline-offset-4"
          >
            Open tags to rescan
          </Link>
        )}
      </section>

      <section className={SECTION} aria-labelledby="cmp-pkgs">
        <Heading
          id="cmp-pkgs"
          title="Packages"
          hint="Software that differs between the two images."
        />
        {tot === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No package changes.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="Search changed packages"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search packages"
                className="min-w-0 flex-1 basis-48"
              />
              <select
                aria-label="Filter changed packages by type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={cn(SELECT, "pointer-coarse:h-11")}
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            {added.length + removed.length + changed.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No package matches these filters.
              </p>
            )}
            {changed.length > 0 && (
              <div className="grid gap-2">
                <h3 className="text-sm font-medium">
                  Changed ({changed.length})
                </h3>
                <DiffTable label="Changed packages" heads={["Package", "Version", "Change"]}>
                  {changed.slice(0, nChanged).map((c) => {
                    const d = cmpVersion(c.from, c.to)
                    return (
                      <div role="row" key={`${c.type}-${c.name}`} className={ROW}>
                        <span role="cell" className="font-mono text-sm break-all">
                          {c.name}
                        </span>
                        <span role="cell" className="font-mono break-all">
                          <Lbl>Version</Lbl>
                          {c.from} → {c.to}
                        </span>
                        <span role="cell" className="inline-flex items-center gap-1 text-muted-foreground">
                          <Lbl>Change</Lbl>
                          {d === 0 ? null : d < 0 ? <ArrowUpIcon aria-hidden className="size-3" /> : <ArrowDownIcon aria-hidden className="size-3" />}
                          {d === 0 ? "Same version" : d < 0 ? "Upgrade" : "Downgrade"}
                        </span>
                      </div>
                    )
                  })}
                </DiffTable>
                <More
                  shown={nChanged}
                  total={changed.length}
                  onMore={() => setNChanged(nChanged + PAGE * 4)}
                />
              </div>
            )}
            {added.length > 0 && (
              <div className="grid gap-2">
                <h3 className="text-sm font-medium">Added ({added.length})</h3>
                <PkgRows rows={added} kind="added" />
              </div>
            )}
            {removed.length > 0 && (
              <div className="grid gap-2">
                <h3 className="text-sm font-medium">
                  Removed ({removed.length})
                </h3>
                <PkgRows rows={removed} kind="removed" />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
