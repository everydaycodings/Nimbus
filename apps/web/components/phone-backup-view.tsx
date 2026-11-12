"use client"

import {
  ArrowLeftIcon,
  ArrowsLeftRightIcon,
  CalendarBlankIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  RepeatIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatBytes } from "@/lib/file-types"
import { cn } from "@/lib/utils"
import type { PhoneBackupCopy, PhoneBackupDevice, PhoneBackupType } from "@nimbus/shared/api"
import { type CalEvent, diffEvents, eventKey, eventStartMs, eventWhen, parseICal, writeICal } from "@nimbus/shared/ical"
import { type Contact, type Diff, contactKey, diffContacts, parseVCards, writeVCard } from "@nimbus/shared/vcard"

type Tab = "contacts" | "events" | "compare"
const TYPE_OF: Record<"contacts" | "events", PhoneBackupType> = { contacts: "contacts", events: "calendar" }
const PAGE = 100

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
const copyDate = (c: PhoneBackupCopy) => WHEN.format(new Date(c.createdAt))
const copyLabel = (c: PhoneBackupCopy) => `${copyDate(c)} · ${formatBytes(c.size)}`

function ago(iso: string | null) {
  if (!iso) return "never"
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  if (m < 2880) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} days ago`
}

function save(name: string, text: string, mime: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name.replace(/[/\\:*?"<>|]+/g, "_") || "export"
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Downloads a copy and parses it here. A parsed copy is kept for the visit.
const cache = new Map<string, unknown[]>()
function useCopy<T>(copy: PhoneBackupCopy | undefined, parse: (t: string) => T[]) {
  const [got, setGot] = useState<{ id: string; data: T[]; error: string } | null>(null)
  const id = copy?.id
  useEffect(() => {
    if (!id) return
    const hit = cache.get(id) as T[] | undefined
    if (hit) return setGot({ id, data: hit, error: "" })
    let live = true
    fetch(`/api/files/${id}/download`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("The file couldn't be downloaded."))))
      .then((t) => {
        const data = parse(t)
        cache.set(id, data)
        if (live) setGot({ id, data, error: "" })
      })
      .catch((e: Error) => live && setGot({ id, data: [], error: e.message || "That copy couldn't be read." }))
    return () => {
      live = false
    }
    // parse is a module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const ready = got && got.id === id
  return { loading: Boolean(id) && !ready, error: ready ? got.error : "", data: ready ? got.data : ([] as T[]) }
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground",
        tone === "error" && "border-destructive/40 text-destructive"
      )}
    >
      {children}
    </div>
  )
}

const Loading = () => (
  <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
    ))}
  </div>
)

function Search({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  )
}

const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-input/30 px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

function CopyPicker({
  label,
  copies,
  value,
  onChange,
}: {
  label: string
  copies: PhoneBackupCopy[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {copies.map((c) => (
          <option key={c.id} value={c.id}>
            {copyLabel(c)}
          </option>
        ))}
      </select>
    </label>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-0.5 text-sm sm:grid-cols-[8rem_1fr] sm:gap-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words whitespace-pre-wrap">{children}</dd>
  </div>
)

const SAFE_IMAGE = /^image\/(jpeg|png|gif|webp)$/

const contactTitle = (c: Contact) => c.name || c.phones[0]?.value || c.emails[0]?.value || "No name"
const contactText = (c: Contact) =>
  [c.name, c.nickname, c.org, ...c.phones.map((p) => p.value), ...c.emails.map((e) => e.value)].join("\n").toLowerCase()

function ContactDetail({ c, onBack }: { c: Contact; onBack: () => void }) {
  const addresses = c.addresses.map((a) => ({
    type: a.type,
    text: [a.street, a.city, [a.region, a.postal].filter(Boolean).join(" "), a.country].filter(Boolean).join("\n"),
  }))
  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Back to the list">
          <ArrowLeftIcon />
        </Button>
        {c.photo && SAFE_IMAGE.test(c.photo.mime) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:${c.photo.mime};base64,${c.photo.base64}`}
            alt=""
            className="size-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserIcon className="size-7" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold break-words">{contactTitle(c)}</h2>
          <p className="text-sm break-words text-muted-foreground">
            {[c.title, c.org].filter(Boolean).join(" · ") || c.nickname}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => save(`${contactTitle(c)}.vcf`, writeVCard(c), "text/vcard")}
        >
          <DownloadSimpleIcon /> .vcf
        </Button>
      </div>
      <dl className="flex flex-col gap-3">
        {c.phones.map((p, i) => (
          <Field key={`p${i}`} label={p.type ? `Phone (${p.type})` : "Phone"}>
            <a href={`tel:${p.value}`} className="hover:underline">
              {p.value}
            </a>
          </Field>
        ))}
        {c.emails.map((e, i) => (
          <Field key={`e${i}`} label={e.type ? `Email (${e.type})` : "Email"}>
            <a href={`mailto:${e.value}`} className="hover:underline">
              {e.value}
            </a>
          </Field>
        ))}
        {addresses.map((a, i) => (
          <Field key={`a${i}`} label={a.type ? `Address (${a.type})` : "Address"}>
            {a.text}
          </Field>
        ))}
        {c.org && <Field label="Organisation">{c.org}</Field>}
        {c.nickname && c.name && <Field label="Nickname">{c.nickname}</Field>}
        {c.birthday && <Field label="Birthday">{c.birthday}</Field>}
        {c.urls.map((u, i) => (
          <Field key={`u${i}`} label="Website">
            {u}
          </Field>
        ))}
        {c.note && <Field label="Notes">{c.note}</Field>}
      </dl>
    </div>
  )
}

function ContactsTab({ copy }: { copy: PhoneBackupCopy | undefined }) {
  const { loading, error, data } = useCopy(copy, parseVCards)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data
      .map((c) => ({ c, key: contactKey(c) }))
      .filter((x) => !s || contactText(x.c).includes(s))
      .sort((a, b) => contactTitle(a.c).localeCompare(contactTitle(b.c)))
  }, [data, q])
  if (!copy) return <Notice>No contacts backed up yet. Turn on Contacts in the app&apos;s Backup settings.</Notice>
  if (error) return <Notice tone="error">{error}</Notice>
  if (loading) return <Loading />
  const current = list.find((x) => x.key === open)
  return (
    <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <div className={cn("flex min-w-0 flex-col gap-3", current && "max-md:hidden")}>
        <Search value={q} onChange={(v) => { setQ(v); setShown(PAGE) }} label={`Search ${data.length} contacts`} />
        {list.length === 0 ? (
          <Notice>{data.length ? "No contact matches." : "This copy has no contacts."}</Notice>
        ) : (
          <ul className="flex flex-col">
            {list.slice(0, shown).map(({ c, key }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setOpen(key)}
                  aria-current={key === open}
                  className={cn(
                    "flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-muted",
                    key === open && "bg-muted"
                  )}
                >
                  <span className="truncate text-sm font-medium">{contactTitle(c)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {c.phones[0]?.value || c.emails[0]?.value || c.org}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.length > shown && (
          <Button variant="ghost" size="sm" onClick={() => setShown(shown + PAGE)}>
            Show more ({list.length - shown})
          </Button>
        )}
      </div>
      <div className={cn("min-w-0", !current && "max-md:hidden")}>
        {current ? (
          <ContactDetail c={current.c} onBack={() => setOpen(null)} />
        ) : (
          <Notice>Pick a contact to see the details.</Notice>
        )}
      </div>
    </div>
  )
}

function EventRow({ e }: { e: CalEvent }) {
  const w = eventWhen(e)
  const time = w.time ? `${w.time}${w.endTime ? ` – ${w.endTime}` : ""}` : "All day"
  const span = w.endDate !== w.date ? ` (until ${DAY.format(new Date(w.endDate + "T00:00:00"))})` : ""
  return (
    <li className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50">
      <span className="w-24 shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">{time}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium break-words">
          {e.summary || "No title"}
          <span className="font-normal text-muted-foreground">{span}</span>
        </span>
        {e.location && (
          <span className="flex items-start gap-1 text-xs text-muted-foreground">
            <MapPinIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{e.location}</span>
          </span>
        )}
        {e.rrule && (
          <Badge variant="secondary" title={e.rrule}>
            <RepeatIcon /> Repeats
          </Badge>
        )}
        {e.description && (
          <span className="line-clamp-3 text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {e.description}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Export ${e.summary || "event"} as .ics`}
        title="Export as .ics"
        onClick={() => save(`${e.summary || "event"}.ics`, writeICal([e]), "text/calendar")}
      >
        <DownloadSimpleIcon />
      </Button>
    </li>
  )
}

function EventsTab({ copy }: { copy: PhoneBackupCopy | undefined }) {
  const { loading, error, data } = useCopy(copy, parseICal)
  const [q, setQ] = useState("")
  const [shown, setShown] = useState(PAGE)
  const days = useMemo(() => {
    const s = q.trim().toLowerCase()
    const events = data
      .filter((e) => !s || `${e.summary}\n${e.location}\n${e.description}`.toLowerCase().includes(s))
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))
    const groups = new Map<string, CalEvent[]>()
    for (const e of events) {
      const d = eventWhen(e).date
      groups.set(d, [...(groups.get(d) ?? []), e])
    }
    return [...groups]
  }, [data, q])
  if (!copy) return <Notice>No calendar backed up yet. Turn on Calendar in the app&apos;s Backup settings.</Notice>
  if (error) return <Notice tone="error">{error}</Notice>
  if (loading) return <Loading />
  // Whole days, so a day is never cut in half.
  let count = 0
  const visible = days.filter(([, es]) => (count < shown ? ((count += es.length), true) : false))
  return (
    <div className="flex flex-col gap-3">
      <Search value={q} onChange={(v) => { setQ(v); setShown(PAGE) }} label={`Search ${data.length} events`} />
      {days.length === 0 ? (
        <Notice>{data.length ? "No event matches." : "This copy has no events."}</Notice>
      ) : (
        visible.map(([day, es]) => (
          <section key={day} className="flex flex-col">
            <h3 className="sticky top-0 bg-background/95 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
              {day ? DAY.format(new Date(day + "T00:00:00")) : "No date"}
            </h3>
            <ul>
              {es.map((e) => (
                <EventRow key={eventKey(e) || e.summary} e={e} />
              ))}
            </ul>
          </section>
        ))
      )}
      {visible.length < days.length && (
        <Button variant="ghost" size="sm" onClick={() => setShown(shown + PAGE)}>
          Show more days
        </Button>
      )}
    </div>
  )
}

function Changes({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className={cn("px-1 text-sm font-semibold", tone)}>{title}</h3>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">{children}</ul>
    </section>
  )
}

function DiffView<T>({
  diff,
  name,
  sub,
}: {
  diff: Diff<T>
  name: (t: T) => string
  sub: (t: T) => string
}) {
  if (!diff.added.length && !diff.removed.length && !diff.changed.length)
    return <Notice>These two copies are the same.</Notice>
  const row = (t: T, i: number) => (
    <li key={i} className="flex flex-col px-3 py-2">
      <span className="text-sm font-medium break-words">{name(t)}</span>
      <span className="text-xs break-words text-muted-foreground">{sub(t)}</span>
    </li>
  )
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {diff.added.length} added · {diff.removed.length} removed · {diff.changed.length} changed
      </p>
      {diff.added.length > 0 && (
        <Changes title={`Added (${diff.added.length})`} tone="text-primary">
          {diff.added.map(row)}
        </Changes>
      )}
      {diff.removed.length > 0 && (
        <Changes title={`Removed (${diff.removed.length})`} tone="text-destructive">
          {diff.removed.map(row)}
        </Changes>
      )}
      {diff.changed.length > 0 && (
        <Changes title={`Changed (${diff.changed.length})`} tone="text-foreground">
          {diff.changed.map(({ after, changes }, i) => (
            <li key={i} className="flex flex-col gap-2 px-3 py-2.5">
              <span className="text-sm font-medium break-words">{name(after)}</span>
              {changes.map((c) => (
                <div key={c.field} className="grid gap-0.5 text-xs sm:grid-cols-[8rem_1fr_1fr] sm:gap-3">
                  <span className="text-muted-foreground">{c.field}</span>
                  <span className="break-words whitespace-pre-wrap text-destructive/90">{c.from || "empty"}</span>
                  <span className="break-words whitespace-pre-wrap text-primary">{c.to || "empty"}</span>
                </div>
              ))}
            </li>
          ))}
        </Changes>
      )}
    </div>
  )
}

function CompareTab({ device }: { device: PhoneBackupDevice }) {
  const [kind, setKind] = useState<"contacts" | "events">(device.contacts || !device.calendar ? "contacts" : "events")
  const copies = device.copies.filter((c) => c.type === TYPE_OF[kind])
  // Newest first, so by default: the previous copy against the latest.
  const [pick, setPick] = useState<{ kind: string; a?: string; b?: string }>({ kind })
  const a = copies.find((c) => c.id === (pick.kind === kind ? pick.a : undefined)) ?? copies[1]
  const b = copies.find((c) => c.id === (pick.kind === kind ? pick.b : undefined)) ?? copies[0]
  const A = useCopy(kind === "contacts" ? a : undefined, parseVCards)
  const B = useCopy(kind === "contacts" ? b : undefined, parseVCards)
  const EA = useCopy(kind === "events" ? a : undefined, parseICal)
  const EB = useCopy(kind === "events" ? b : undefined, parseICal)
  const [x, y] = kind === "contacts" ? [A, B] : [EA, EB]
  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit rounded-lg border p-0.5" role="group" aria-label="What to compare">
        {(["contacts", "events"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-md px-3 py-1 text-sm",
              kind === k ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {k === "contacts" ? "Contacts" : "Events"}
          </button>
        ))}
      </div>
      {copies.length < 2 ? (
        <Notice>Compare needs two copies. This phone has {copies.length} so far.</Notice>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyPicker label="Before" copies={copies} value={a!.id} onChange={(id) => setPick({ kind, a: id, b: b!.id })} />
            <CopyPicker label="After" copies={copies} value={b!.id} onChange={(id) => setPick({ kind, a: a!.id, b: id })} />
          </div>
          {x.error || y.error ? (
            <Notice tone="error">{x.error || y.error}</Notice>
          ) : x.loading || y.loading ? (
            <Loading />
          ) : kind === "contacts" ? (
            <DiffView
              diff={diffContacts(A.data, B.data)}
              name={contactTitle}
              sub={(c) => c.phones[0]?.value || c.emails[0]?.value || c.org}
            />
          ) : (
            <DiffView
              diff={diffEvents(EA.data, EB.data)}
              name={(e) => e.summary || "No title"}
              sub={(e) => [eventWhen(e).date, eventWhen(e).time, e.location].filter(Boolean).join(" · ")}
            />
          )}
        </>
      )}
    </div>
  )
}

export function PhoneBackupView({ device }: { device: PhoneBackupDevice }) {
  const [tab, setTab] = useState<Tab>(device.contacts || !device.calendar ? "contacts" : "events")
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const type = tab === "events" ? "calendar" : "contacts"
  const copies = device.copies.filter((c) => c.type === type)
  const copy = copies.find((c) => c.id === chosen[type]) ?? copies[0]
  const tabs: [Tab, string, React.ReactNode][] = [
    ["contacts", "Contacts", <UserIcon key="c" />],
    ["events", "Events", <CalendarBlankIcon key="e" />],
    ["compare", "Compare", <ArrowsLeftRightIcon key="x" />],
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm">
        <span>
          <span className="text-muted-foreground">Contacts </span>
          {device.contacts || device.lastContactsAt ? ago(device.lastContactsAt) : "off"}
        </span>
        <span>
          <span className="text-muted-foreground">Calendar </span>
          {device.calendar || device.lastCalendarAt ? ago(device.lastCalendarAt) : "off"}
        </span>
      </div>
      <div className="flex gap-1 border-b" role="tablist">
        {tabs.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm [&>svg]:size-4",
              tab === id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      {tab !== "compare" && copy && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <CopyPicker
              label="Copy"
              copies={copies}
              value={copy.id}
              onChange={(id) => setChosen({ ...chosen, [type]: id })}
            />
          </div>
          <a
            href={`/api/files/${copy.id}/download`}
            download={copy.name}
            className={buttonVariants({ variant: "outline" })}
          >
            <DownloadSimpleIcon /> Download
          </a>
        </div>
      )}
      <div role="tabpanel">
        {tab === "contacts" && <ContactsTab key={copy?.id} copy={copy} />}
        {tab === "events" && <EventsTab key={copy?.id} copy={copy} />}
        {tab === "compare" && <CompareTab device={device} />}
      </div>
    </div>
  )
}
