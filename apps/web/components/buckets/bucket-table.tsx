"use client"

import { Menu } from "@base-ui/react/menu"
import {
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  CopyIcon,
  FolderOpenIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  ProhibitIcon,
  SpeakerSlashIcon,
  CubeIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useId, useMemo, useState, useTransition } from "react"

import { setQuiet, unmarkBucket } from "@/app/(app)/buckets/actions"
import { ConfirmDialog } from "@/components/buckets/confirm-dialog"
import { TABLE, TD, TH } from "@/components/buckets/table-styles"
import { MENU_ITEM } from "@/components/overlay-styles"
import { DAY, RowMenu, SELECT, TOUCH } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatBytes } from "@/lib/file-types"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"
import { keyReaches } from "@/lib/s3api/rules"

type Col = "name" | "bytes" | "objects" | "keys" | "created"
const COLS: [Col, string][] = [
  ["name", "Name"],
  ["bytes", "Size"],
  ["objects", "Objects"],
  ["keys", "Keys with access"],
  ["created", "Created"],
]
// Hidden on a phone, where the name cell carries the numbers.
const HIDE: Record<Col, string> = {
  name: "",
  bytes: "hidden sm:table-cell",
  objects: "hidden md:table-cell",
  keys: "hidden md:table-cell",
  created: "hidden lg:table-cell",
}
const PAGE = 25
const NUM = new Intl.NumberFormat("en")
const plural = (n: number, one: string, many: string) => `${NUM.format(n)} ${n === 1 ? one : many}`

export function BucketTable({
  buckets,
  keys,
  url,
  onNewKey,
}: {
  buckets: BucketRow[]
  keys: KeyRow[]
  url: string
  onNewKey: (bucketId: string) => void
}) {
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<{ col: Col; desc: boolean }>({ col: "name", desc: false })
  const [stopping, setStopping] = useState<BucketRow | null>(null)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const router = useRouter()
  const params = useSearchParams()
  // The page lives in the URL (?page=) so a reload keeps it.
  const goto = (n: number) => {
    const p = new URLSearchParams(params)
    if (n <= 1) p.delete("page")
    else p.set("page", String(n))
    router.replace(`?${p}`, { scroll: false })
  }
  const searchId = useId()
  const sortId = useId()

  const rows = useMemo(() => {
    const withKeys = buckets.map((b) => ({ b, keys: keys.filter((k) => keyReaches(k, b.name)).length }))
    const val = (r: (typeof withKeys)[number]) =>
      ({ name: r.b.name, bytes: r.b.bytes, objects: r.b.objects, keys: r.keys, created: r.b.createdAt })[sort.col]
    const term = q.trim().toLowerCase()
    return withKeys
      .filter((r) => !term || r.b.name.includes(term))
      .sort((x, y) => (val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : 0) * (sort.desc ? -1 : 1))
  }, [buckets, keys, q, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get("page"))) || 1))
  const from = (page - 1) * PAGE
  const shown = rows.slice(from, from + PAGE)

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    setNotice({ text: `Copied the ${what}.` })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor={searchId} className="sr-only">
            Search buckets
          </label>
          <Input id={searchId} type="search" value={q} onChange={(e) => {
              setQ(e.target.value)
              goto(1)
            }} placeholder="Search buckets" className="pl-8" autoComplete="off" />
        </div>
        {/* The column headers that sort are hidden on a phone, so it gets a menu. */}
        <label htmlFor={sortId} className="sr-only">
          Sort by
        </label>
        <select
          id={sortId}
          value={`${sort.col}:${sort.desc ? "desc" : "asc"}`}
          onChange={(e) => {
            const [col, d] = e.target.value.split(":")
            setSort({ col: col as Col, desc: d === "desc" })
            goto(1)
          }}
          className={`${SELECT} sm:hidden`}
        >
          {COLS.flatMap(([c, l]) => [
            <option key={`${c}a`} value={`${c}:asc`}>
              {l}, {c === "name" ? "A to Z" : c === "created" ? "oldest first" : "low to high"}
            </option>,
            <option key={`${c}d`} value={`${c}:desc`}>
              {l}, {c === "name" ? "Z to A" : c === "created" ? "newest first" : "high to low"}
            </option>,
          ])}
        </select>
      </div>

      {rows.length === 0 ? (
        <p role="status" className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No bucket matches “{q.trim()}”.
        </p>
      ) : (
        <div className={TABLE.wrap}>
          <table className={TABLE.table}>
            <caption className="sr-only">Buckets</caption>
            <thead>
              <tr>
                {COLS.map(([c, label]) => {
                  const on = sort.col === c
                  return (
                    <th
                      key={c}
                      scope="col"
                      aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}
                      className={`${TH} ${HIDE[c]} sticky top-0 z-10 bg-card p-0!`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSort({ col: c, desc: on ? !sort.desc : false })
                          goto(1)
                        }}
                        className="flex w-full items-center gap-1 rounded-sm px-4 py-2.5 text-left text-xs font-medium outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                      >
                        {label}
                        {on ? sort.desc ? <CaretDownIcon aria-hidden className="size-3" /> : <CaretUpIcon aria-hidden className="size-3" /> : null}
                      </button>
                    </th>
                  )
                })}
                <th scope="col" className={`${TH} sticky top-0 z-10 w-12 bg-card`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody suppressHydrationWarning>
              {shown.map(({ b, keys: n }) => (
                <tr key={b.id} className="border-t">
                  <th scope="row" className={`${TD} text-left font-normal`}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/buckets/${b.name}`}
                        title={b.name}
                        className="max-w-full truncate rounded-sm font-mono text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 md:max-w-64"
                      >
                        {b.name}
                      </Link>
                      {b.role === "viewer" && <Badge variant="outline">Read only</Badge>}
                      {b.gone && <Badge variant="secondary">Hidden</Badge>}
                      {/* Most buckets are quiet (new ones start that way), so it's a small mark, not a badge. */}
                      {b.quiet && (
                        <span className="text-muted-foreground" title="Quiet: no thumbnails, indexing or notifications for S3 uploads">
                          <SpeakerSlashIcon aria-hidden className="size-3.5" />
                          <span className="sr-only">Quiet</span>
                        </span>
                      )}
                    </div>
                    <p className={`mt-0.5 text-xs text-pretty text-muted-foreground ${b.gone ? "" : "md:max-w-64 md:truncate"}`} title={b.gone ? undefined : b.path}>
                      {b.gone ? (
                        <>
                          {b.path} · {b.role === "owner" ? "In the trash" : "No longer shared with you"}. Apps can&apos;t see this bucket.
                        </>
                      ) : (
                        <>
                          {b.owner ? `Shared by ${b.owner}` : b.path}
                          <span className="tabular-nums md:hidden">
                            {" · "}
                            <span className="sm:hidden">{formatBytes(b.bytes)} · </span>
                            {plural(b.objects, "object", "objects")} · {plural(n, "key", "keys")}
                          </span>
                        </>
                      )}
                    </p>
                  </th>
                  <td className={`${TD} ${HIDE.bytes} tabular-nums`}>{b.gone ? "–" : formatBytes(b.bytes)}</td>
                  <td className={`${TD} ${HIDE.objects} tabular-nums`}>{b.gone ? "–" : NUM.format(b.objects)}</td>
                  <td className={`${TD} ${HIDE.keys} tabular-nums`}>{n}</td>
                  <td className={`${TD} ${HIDE.created} text-xs whitespace-nowrap text-muted-foreground`}>{DAY.format(new Date(b.createdAt))}</td>
                  <td className={`${TD} text-right`}>
                    <RowMenu label={`Actions for ${b.name}`}>
                      <Menu.Item className={MENU_ITEM} render={<Link href={`/buckets/${b.name}`} />}>
                        <CubeIcon />
                        Open
                      </Menu.Item>
                      <Menu.Item className={MENU_ITEM} disabled={b.gone} render={<Link href={`/folders/${b.nodeId}`} />}>
                        <FolderOpenIcon />
                        Open in Files
                      </Menu.Item>
                      <Menu.Item className={MENU_ITEM} onClick={() => copy(url, "endpoint")}>
                        <CopyIcon />
                        Copy endpoint
                      </Menu.Item>
                      <Menu.Item className={MENU_ITEM} onClick={() => copy(`s3://${b.name}`, "s3:// address")}>
                        <CopyIcon />
                        Copy s3:// URI
                      </Menu.Item>
                      <Menu.Item className={MENU_ITEM} onClick={() => onNewKey(b.id)}>
                        <KeyIcon />
                        New key for this bucket
                      </Menu.Item>
                      <Menu.CheckboxItem
                        className={`${MENU_ITEM} relative pr-8`}
                        checked={b.quiet}
                        closeOnClick={false}
                        onCheckedChange={(on) =>
                          start(async () => {
                            const r = await setQuiet(b.id, on)
                            if (r.error) setNotice({ text: r.error, error: true })
                          })
                        }
                      >
                        <SpeakerSlashIcon />
                        Quiet
                        <Menu.CheckboxItemIndicator className="absolute right-2">
                          <CheckIcon />
                        </Menu.CheckboxItemIndicator>
                      </Menu.CheckboxItem>
                      <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
                      <Menu.Item
                        className={`${MENU_ITEM} text-destructive`}
                        onClick={() => {
                          setError(undefined)
                          setStopping(b)
                        }}
                      >
                        <ProhibitIcon className="text-destructive!" />
                        Stop using…
                      </Menu.Item>
                    </RowMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > PAGE && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
            Showing {from + 1}–{from + shown.length} of {rows.length}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className={TOUCH} disabled={page <= 1} onClick={() => goto(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" className={TOUCH} disabled={page >= pages} onClick={() => goto(page + 1)}>
              Next
            </Button>
          </div>
        </nav>
      )}

      <ConfirmDialog
        open={stopping !== null}
        title={`Stop using “${stopping?.name ?? ""}” as a bucket?`}
        body="Files stay where they are. Apps lose this bucket."
        yes="Stop using"
        pending={pending}
        error={error}
        onClose={() => setStopping(null)}
        onYes={() =>
          start(async () => {
            const r = await unmarkBucket(stopping!.id)
            if (r.error) return setError(r.error)
            setNotice({ text: `“${stopping!.name}” is a normal folder again.` })
            setStopping(null)
          })
        }
      />
    </div>
  )
}
