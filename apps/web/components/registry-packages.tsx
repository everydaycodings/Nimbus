"use client"

import { Menu } from "@base-ui/react/menu"
import { Popover } from "@base-ui/react/popover"
import { DotsThreeIcon, DownloadSimpleIcon, FunnelSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"

import { downloadSbom, tagPackages } from "@/app/(app)/registry/actions"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { LIST, SELECT, TOUCH, useLate } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { blockedLicenseHits } from "@/lib/registry/extras-rules"
import { cn } from "@/lib/utils"

export type Pkg = {
  name: string
  version: string
  type: string
  licenses: string[]
}
type Data = {
  source: "sbom" | "scan" | null
  format?: string
  packages: Pkg[]
  truncated: boolean
  // Findings per package name from the last scan; null when there's no finished scan.
  vulns: Record<string, { critical: number; high: number; total: number }> | null
  // The name's image policy blocks these licenses.
  blockedLicenses: string[]
}

const PAGE = 50
const SORTS = [
  ["name", "Name"],
  ["version", "Version"],
  ["type", "Type"],
] as const
type Sort = (typeof SORTS)[number][0]

const SOURCE = (d: Data) =>
  d.source === "sbom"
    ? `From the image's SBOM (${d.format === "cyclonedx" ? "CycloneDX" : "SPDX"})`
    : "From the vulnerability scan"

// Saves text as a file in the browser.
export function saveFile(f: {
  filename: string
  contentType: string
  body: string
}) {
  const url = URL.createObjectURL(new Blob([f.body], { type: f.contentType }))
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: f.filename,
  })
  a.click()
  URL.revokeObjectURL(url)
}

export function PackagesView({
  name,
  tag,
  platforms,
}: {
  name: string
  tag: string
  platforms: string[]
}) {
  const setNotice = useNotice()
  const [platform, setPlatform] = useState(platforms[0] ?? "")
  const [data, setData] = useState<Data | null | "loading">("loading")
  const [q, setQ] = useState("")
  const [type, setType] = useState("")
  const [license, setLicense] = useState("")
  const [sort, setSort] = useState<Sort>("name")
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setData("loading")
    tagPackages(name, tag, platform || undefined)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [name, tag, platform])

  const pkgs = useMemo(
    () => (data && data !== "loading" ? data.packages : []),
    [data]
  )
  const types = useMemo(
    () => [...new Set(pkgs.map((p) => p.type))].sort(),
    [pkgs]
  )
  const licenses = useMemo(
    () => [...new Set(pkgs.flatMap((p) => p.licenses))].sort(),
    [pkgs]
  )
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    const r = pkgs.filter(
      (p) =>
        (!n || p.name.toLowerCase().includes(n)) &&
        (!type || p.type === type) &&
        (!license || p.licenses.includes(license))
    )
    return r.sort(
      (a, b) =>
        a[sort].localeCompare(b[sort], "en", { numeric: true }) ||
        a.name.localeCompare(b.name)
    )
  }, [pkgs, q, type, license, sort])

  const reading = useLate("Reading packages…")
  const exportAs = async (format: "csv" | "spdx-json") => {
    setBusy(true)
    const f = await downloadSbom(name, tag, format).catch(() => null)
    setBusy(false)
    if (!f)
      return setNotice({
        text: "There's no package list to export for this image.",
        error: true,
      })
    saveFile(f)
  }

  if (data === "loading")
    return (
      <p role="status" className="min-h-5 py-4 text-sm text-muted-foreground">
        {reading}
      </p>
    )
  if (!data || !data.source || pkgs.length === 0)
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        {data?.source
          ? "This image has no packages we can list."
          : "No package list yet. It appears once the image is scanned, or when it carries an SBOM."}
      </p>
    )
  const blocked = (p: Pkg) =>
    data.blockedLicenses.length > 0 &&
    blockedLicenseHits(data.blockedLicenses, p.licenses).length > 0
  const hasVulns = data.vulns !== null
  const cols = hasVulns
    ? "md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_minmax(0,1.3fr)_6rem]"
    : "md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_minmax(0,1.3fr)]"
  const active = [type, license].filter(Boolean).length
  const label = "text-muted-foreground md:hidden"
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        <span className="tabular-nums">
          {pkgs.length.toLocaleString()} packages · {types.length}{" "}
          {types.length === 1 ? "type" : "types"} · {licenses.length}{" "}
          {licenses.length === 1 ? "license" : "licenses"}
        </span>
        <span className="block text-xs text-muted-foreground">
          {SOURCE(data)}
          {data.truncated &&
            ` · Showing the first ${pkgs.length.toLocaleString()}; the image has more.`}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search packages"
          type="search"
          value={q}
          onChange={(e) => (setQ(e.target.value), setShown(PAGE))}
          placeholder="Search packages"
          className="min-w-0 flex-1 basis-48"
        />
        <Popover.Root>
          <Popover.Trigger
            render={<Button type="button" variant="outline" className={TOUCH} />}
          >
            <FunnelSimpleIcon />
            Filters{active ? ` (${active})` : ""}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6}>
              <Popover.Popup
                className={cn(
                  MENU_POPUP,
                  "grid w-[min(20rem,calc(100vw-1rem))] gap-3 p-4"
                )}
              >
                <Popover.Title className="text-sm font-semibold">
                  Filter packages
                </Popover.Title>
                {platforms.length > 1 && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Platform
                    <select
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      className={cn(SELECT, "text-foreground pointer-coarse:h-11")}
                    >
                      {platforms.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Type
                  <select
                    value={type}
                    onChange={(e) => (setType(e.target.value), setShown(PAGE))}
                    className={cn(SELECT, "text-foreground pointer-coarse:h-11")}
                  >
                    <option value="">All types</option>
                    {types.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  License
                  <select
                    value={license}
                    onChange={(e) => (setLicense(e.target.value), setShown(PAGE))}
                    className={cn(SELECT, "text-foreground pointer-coarse:h-11")}
                  >
                    <option value="">All licenses</option>
                    {licenses.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                {active > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(TOUCH, "w-fit")}
                    onClick={() => (setType(""), setLicense(""), setShown(PAGE))}
                  >
                    Clear filters
                  </Button>
                )}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <select
          aria-label="Sort packages"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className={cn(SELECT, "pointer-coarse:h-11")}
        >
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              Sort by {l.toLowerCase()}
            </option>
          ))}
        </select>
        <Menu.Root>
          <Menu.Trigger
            disabled={busy}
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Export packages"
                className="pointer-coarse:size-11"
              />
            }
          >
            <DotsThreeIcon weight="bold" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4}>
              <Menu.Popup className={cn("w-52", MENU_POPUP)}>
                <Menu.Item className={MENU_ITEM} onClick={() => exportAs("csv")}>
                  <DownloadSimpleIcon />
                  Export CSV
                </Menu.Item>
                <Menu.Item
                  className={MENU_ITEM}
                  onClick={() => exportAs("spdx-json")}
                >
                  <DownloadSimpleIcon />
                  Export SPDX JSON
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No package matches these filters.
        </p>
      ) : (
        <div className={LIST} role="table" aria-label={`Packages in ${tag}`}>
          <div role="rowgroup" className="max-md:sr-only">
            <div
              role="row"
              className={cn(
                "grid items-center gap-x-3 px-4 py-2 text-xs text-muted-foreground",
                cols
              )}
            >
              <span role="columnheader">Name</span>
              <span role="columnheader">Version</span>
              <span role="columnheader">Type</span>
              <span role="columnheader">License</span>
              {hasVulns && <span role="columnheader">Vulnerabilities</span>}
            </div>
          </div>
          <div role="rowgroup" className="divide-y">
            {rows.slice(0, shown).map((p, i) => {
              const v = data.vulns?.[p.name]
              return (
                <div
                  role="row"
                  key={`${p.type}-${p.name}-${p.version}-${i}`}
                  className={cn(
                    "grid items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-xs",
                    cols
                  )}
                >
                  <span role="cell" className="font-mono text-sm break-all">
                    {p.name}
                  </span>
                  <span role="cell" className="font-mono break-all text-muted-foreground">
                    <span className={label}>Version </span>
                    {p.version || "—"}
                  </span>
                  <span role="cell" className="text-muted-foreground">
                    <span className={label}>Type </span>
                    {p.type}
                  </span>
                  <span role="cell" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 break-words text-muted-foreground">
                    <span>
                      <span className={label}>License </span>
                      {p.licenses.length ? p.licenses.join(", ") : "—"}
                    </span>
                    {blocked(p) && (
                      <Badge variant="outline" className="text-destructive">
                        Blocked by policy
                      </Badge>
                    )}
                  </span>
                  {hasVulns && (
                    <span role="cell" className="tabular-nums text-muted-foreground">
                      <span className={label}>Vulnerabilities </span>
                      {v ? (
                        <span className="text-foreground">
                          {v.total}
                          {(v.critical > 0 || v.high > 0) && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({v.critical} C, {v.high} H)
                            </span>
                          )}
                        </span>
                      ) : (
                        "0"
                      )}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {rows.length > shown && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(TOUCH, "w-fit")}
          onClick={() => setShown((n) => n + 500)}
        >
          Show {Math.min(500, rows.length - shown).toLocaleString()} more of{" "}
          {(rows.length - shown).toLocaleString()}
        </Button>
      )}
    </div>
  )
}
