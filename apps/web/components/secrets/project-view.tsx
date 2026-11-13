"use client"

import {
  ArrowLeftIcon,
  ArrowDownIcon,
  CertificateIcon,
  HeartbeatIcon,
  LockKeyIcon,
  DatabaseIcon,
  IdentificationCardIcon,
  ArrowUpIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  FolderSimpleIcon,
  GearSixIcon,
  GitPullRequestIcon,
  HourglassMediumIcon,
  KeyIcon,
  TerminalWindowIcon,
  LinkIcon,
  ScrollIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  RowsIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { AccessRequestsView } from "@/components/secrets/access-requests-view"
import { AccessView } from "@/components/secrets/access-view"
import { AuditView } from "@/components/secrets/audit-view"
import { CertsView } from "@/components/secrets/certs-view"
import { api, errorText } from "@/components/secrets/client"
import { DynamicView } from "@/components/secrets/dynamic-view"
import { HealthView } from "@/components/secrets/health-view"
import { ItemsView } from "@/components/secrets/items-view"
import { KmsView } from "@/components/secrets/kms-view"
import { OverviewMatrix } from "@/components/secrets/overview-matrix"
import { PoliciesView } from "@/components/secrets/policies-view"
import { RequestsView } from "@/components/secrets/requests-view"
import { SecretsTable } from "@/components/secrets/secrets-table"
import { SharesView } from "@/components/secrets/shares-view"
import { SshView } from "@/components/secrets/ssh-view"
import { SnapshotsView } from "@/components/secrets/snapshots-view"
import { TrashView } from "@/components/secrets/trash-view"
import { Confirm, MenuButton, Modal } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { projectDetail } from "@/lib/secrets/service"
import { cn } from "@/lib/utils"

export type Detail = Awaited<ReturnType<typeof projectDetail>>

type Hit = {
  id: string
  key: string
  comment: string | null
  tags: string[]
  envId: string
  env: string
  folder: string
}

export function ProjectView({
  detail,
  initialView,
  initialFolder,
  initialRequest,
}: {
  detail: Detail
  initialView: string
  initialFolder: string
  initialRequest?: string | null
}) {
  const router = useRouter()
  const slugs = detail.envs.map((e) => e.slug)
  const startView =
    initialView === "overview" ||
    initialView === "trash" ||
    (["access", "audit", "policies"].includes(initialView) && detail.role === "admin") ||
    ["requests", "snapshots", "access-requests", "shares", "ssh", "certs", "items", "dynamic", "health", "kms"].includes(initialView) ||
    slugs.includes(initialView)
      ? initialView
      : "overview"
  const [view, setView] = useState(startView)
  const [folder, setFolder] = useState(initialFolder)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  // Certificates and items that match by name.
  const [named, setNamed] = useState<{ items: { id: string; name: string; kind: string }[]; certs: { id: string; name: string }[] } | null>(null)
  const [dialog, setDialog] = useState<"envs" | "rename" | "delete" | null>(null)
  // A key the Overview asked the table to start with (a missing value to add).
  const [addKey, setAddKey] = useState<string | null>(null)
  // Where Access opens: Health sends token lines to the Machine tokens tab.
  const [accessTab, setAccessTab] = useState<"tokens" | undefined>(undefined)
  const admin = detail.role === "admin"
  const canWrite = detail.writableEnvs.length > 0

  function go(next: string, path = "", key: string | null = null) {
    setView(next)
    setFolder(path)
    setAddKey(key)
    setQ("")
    setHits(null)
    setNamed(null)
  }

  // Governance views change counts in the sidebar (open requests, pending access).
  useEffect(() => {
    const again = () => router.refresh()
    window.addEventListener("secrets-changed", again)
    return () => window.removeEventListener("secrets-changed", again)
  }, [router])

  useEffect(() => {
    const u = new URL(window.location.href)
    u.searchParams.set("view", view)
    if (folder) u.searchParams.set("folder", folder)
    else u.searchParams.delete("folder")
    window.history.replaceState(null, "", u)
  }, [view, folder])

  // Key names, comments and tags; never values.
  useEffect(() => {
    const term = q.trim()
    if (!term) return
    let live = true
    const t = setTimeout(() => {
      api<{ results: Hit[] }>(`/projects/${detail.id}/search?q=${encodeURIComponent(term)}`)
        .then((r) => live && (setHits(r.results), setSearchError(null)))
        .catch((e) => live && setSearchError(errorText(e)))
      api<NonNullable<typeof named>>(`/projects/${detail.id}/pki-search?q=${encodeURIComponent(term)}`)
        .then((r) => live && setNamed(r))
        .catch(() => {})
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, detail.id])

  const env = detail.envs.find((e) => e.slug === view)

  const nav = (active: boolean) =>
    cn(
      "flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:w-full",
      active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    )

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <aside className="flex min-w-0 flex-col gap-3">
        <Link
          href="/secrets"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon className="size-3.5" />
          All projects
        </Link>
        <nav aria-label="Project" className="flex flex-col gap-1">
          <p className="flex h-8 items-center gap-2 px-2.5 text-xs font-medium text-muted-foreground">
            <KeyIcon className="size-3.5" />
            Secrets
          </p>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            <button className={nav(view === "overview")} aria-current={view === "overview" ? "page" : undefined} onClick={() => go("overview")}>
              <RowsIcon className="size-4" />
              Overview
            </button>
            {detail.envs.map((e) => (
              <button
                key={e.id}
                className={nav(view === e.slug)}
                aria-current={view === e.slug ? "page" : undefined}
                onClick={() => go(e.slug)}
              >
                <span className="grid size-4 place-items-center" aria-hidden>
                  <span className="size-1.5 rounded-full bg-current opacity-60" />
                </span>
                {e.name}
                {e.protected && <ShieldCheckIcon className="ml-auto size-3.5 opacity-70" weight="fill" aria-label="Protected" />}
              </button>
            ))}
            <button className={nav(view === "trash")} aria-current={view === "trash" ? "page" : undefined} onClick={() => go("trash")}>
              <TrashIcon className="size-4" />
              Trash
              {detail.trash > 0 && (
                <span className="ml-auto text-xs tabular-nums opacity-70">{detail.trash}</span>
              )}
            </button>
            {admin && (
              <button className={cn(nav(false), "lg:mt-2")} onClick={() => setDialog("envs")}>
                <GearSixIcon className="size-4" />
                Environments
              </button>
            )}
            {admin && (
              <button className={nav(view === "access")} aria-current={view === "access" ? "page" : undefined} onClick={() => go("access")}>
                <UsersThreeIcon className="size-4" />
                Access
              </button>
            )}
          </div>
        </nav>
        <nav aria-label="SSH" className="flex flex-col gap-1">
          <button className={nav(view === "ssh")} aria-current={view === "ssh" ? "page" : undefined} onClick={() => go("ssh")}>
            <TerminalWindowIcon className="size-4" />
            SSH
          </button>
        </nav>
        <nav aria-label="Certificates and items" className="flex flex-col gap-1">
          <button className={nav(view === "certs")} aria-current={view === "certs" ? "page" : undefined} onClick={() => go("certs")}>
            <CertificateIcon className="size-4" />
            Certificates
          </button>
          <button className={nav(view === "items")} aria-current={view === "items" ? "page" : undefined} onClick={() => go("items")}>
            <IdentificationCardIcon className="size-4" />
            Items
          </button>
          <button className={nav(view === "dynamic")} aria-current={view === "dynamic" ? "page" : undefined} onClick={() => go("dynamic")}>
            <DatabaseIcon className="size-4" />
            Dynamic secrets
          </button>
        </nav>
        <nav aria-label="Security" className="flex flex-col gap-1">
          <button className={nav(view === "health")} aria-current={view === "health" ? "page" : undefined} onClick={() => go("health")}>
            <HeartbeatIcon className="size-4" />
            Health
          </button>
          <button className={nav(view === "kms")} aria-current={view === "kms" ? "page" : undefined} onClick={() => go("kms")}>
            <LockKeyIcon className="size-4" />
            KMS
          </button>
        </nav>
        <nav aria-label="Governance" className="flex flex-col gap-1">
          <p className="flex h-8 items-center gap-2 px-2.5 text-xs font-medium text-muted-foreground">
            <ShieldCheckIcon className="size-3.5" />
            Governance
          </p>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {(
              [
                ["requests", "Change requests", GitPullRequestIcon, detail.openRequests, true],
                ["snapshots", "Snapshots", ClockCounterClockwiseIcon, 0, true],
                ["access-requests", "Access requests", HourglassMediumIcon, detail.pendingAccess, true],
                ["shares", "Share links", LinkIcon, 0, true],
                ["audit", "Audit", ScrollIcon, 0, admin],
                ["policies", "Policies", ShieldCheckIcon, 0, admin],
              ] as const
            )
              .filter((g) => g[4])
              .map(([id, label, Icon, n]) => (
                <button key={id} className={nav(view === id)} aria-current={view === id ? "page" : undefined} onClick={() => go(id)}>
                  <Icon className="size-4" />
                  {label}
                  {n > 0 && (
                    <span aria-label={`${n} waiting`} className="ml-auto rounded-full bg-foreground px-1.5 text-xs text-background tabular-nums">
                      {n}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-auto flex-col gap-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{detail.name}</h1>
            {detail.description && (
              <p className="max-w-prose text-sm text-pretty text-muted-foreground">{detail.description}</p>
            )}
          </div>
          <div className="relative w-full sm:w-64">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search key names, comments and tags"
              placeholder="Search keys, comments, tags"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pr-8 pl-8"
            />
            {q && (
              <button
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => setQ("")}
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          {admin && (
            <MenuButton
              label="Project settings"
              className="size-9"
              trigger={<DotsThreeIcon weight="bold" className="size-5" />}
              items={[
                { label: "Rename project", icon: <PencilSimpleIcon />, onClick: () => setDialog("rename") },
                { label: "Delete project", icon: <TrashIcon />, danger: true, separator: true, onClick: () => setDialog("delete") },
              ]}
            />
          )}
        </div>

        {detail.grants.length > 0 && (
          <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <HourglassMediumIcon className="size-4 shrink-0" />
            Temporary access:{" "}
            {detail.grants
              .map((g) => `${detail.envs.find((e) => e.id === g.envId)?.name ?? "an environment"} until ${new Intl.DateTimeFormat("en", { timeStyle: "short", dateStyle: "medium" }).format(new Date(g.expiresAt))}`)
              .join("; ")}
          </p>
        )}

        {q.trim() && (hits || searchError) ? (
          <SearchResults
            hits={hits}
            error={searchError}
            term={q.trim()}
            named={named}
            openNamed={(v) => go(v)}
            open={(h) => {
              const slug = detail.envs.find((e) => e.id === h.envId)?.slug
              if (slug) go(slug, h.folder)
            }}
          />
        ) : view === "overview" ? (
          <OverviewMatrix
            detail={detail}
            folder={folder}
            canWrite={canWrite}
            onFolder={setFolder}
            onOpen={(slug, key) => go(slug, folder, key)}
          />
        ) : view === "access" && admin ? (
          <AccessView key={accessTab} detail={detail} initialTab={accessTab} />
        ) : view === "requests" ? (
          <RequestsView detail={detail} initial={initialRequest ?? null} />
        ) : view === "snapshots" ? (
          <SnapshotsView detail={detail} />
        ) : view === "access-requests" ? (
          <AccessRequestsView detail={detail} />
        ) : view === "ssh" ? (
          <SshView detail={detail} />
        ) : view === "certs" ? (
          <CertsView projectId={detail.id} role={detail.role} />
        ) : view === "items" ? (
          <ItemsView projectId={detail.id} role={detail.role} />
        ) : view === "dynamic" ? (
          <DynamicView projectId={detail.id} role={detail.role} />
        ) : view === "health" ? (
          <HealthView projectId={detail.id} onOpen={(v, f, tab) => (setAccessTab(tab === "tokens" ? "tokens" : undefined), go(v, f ?? ""))} />
        ) : view === "kms" ? (
          <KmsView projectId={detail.id} role={detail.role} />
        ) : view === "shares" ? (
          <SharesView />
        ) : view === "audit" && admin ? (
          <AuditView detail={detail} />
        ) : view === "policies" && admin ? (
          <PoliciesView detail={detail} onChanged={() => router.refresh()} />
        ) : view === "trash" ? (
          <TrashView detail={detail} canWrite={canWrite} onChanged={() => router.refresh()} />
        ) : env ? (
          <SecretsTable
            key={`${env.id}:${folder}`}
            detail={detail}
            env={env}
            folder={folder}
            canWrite={detail.writableEnvs.includes(env.id)}
            onFolder={setFolder}
            addKey={addKey}
            onOpenRequests={() => go("requests")}
            onChanged={() => router.refresh()}
          />
        ) : null}
      </section>

      {dialog === "envs" && <EnvManager detail={detail} onClose={() => setDialog(null)} onChanged={() => router.refresh()} onGone={(slug) => view === slug && go("overview")} />}
      {dialog === "rename" && <RenameProject detail={detail} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <Confirm
          title={`Delete ${detail.name}?`}
          description="Every environment, folder and secret in this project is deleted for good, trash included. This can't be undone."
          action="Delete project"
          danger
          run={async () => {
            await api(`/projects/${detail.id}`, "DELETE")
            router.push("/secrets")
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function SearchResults({
  hits,
  error,
  term,
  open,
  named,
  openNamed,
}: {
  hits: Hit[] | null
  error: string | null
  term: string
  open: (h: Hit) => void
  named: { items: { id: string; name: string; kind: string }[]; certs: { id: string; name: string }[] } | null
  openNamed: (view: "certs" | "items") => void
}) {
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!hits) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground" role="status">
        {hits.length ? `${hits.length} match${hits.length === 1 ? "" : "es"}` : `Nothing matches “${term}”`} in
        key names, comments and tags. Values aren&apos;t searched.
      </p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              onClick={() => open(h)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="font-mono text-sm">{h.key}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {h.env}
                {h.folder && (
                  <>
                    <FolderSimpleIcon className="size-3" />
                    {h.folder}
                  </>
                )}
              </span>
              {h.tags.map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t}
                </span>
              ))}
              {h.comment && (
                <span className="basis-full truncate text-xs text-muted-foreground">{h.comment}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {named && (named.items.length > 0 || named.certs.length > 0) && (
        <>
          <p className="text-sm text-muted-foreground">Certificates and items, by name</p>
          <ul className="flex flex-col divide-y rounded-xl border">
            {named.certs.map((c) => (
              <li key={c.id}>
                <button onClick={() => openNamed("certs")} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                  <CertificateIcon className="size-4 text-muted-foreground" />
                  {c.name}
                  <span className="text-xs text-muted-foreground">Certificate</span>
                </button>
              </li>
            ))}
            {named.items.map((i) => (
              <li key={i.id}>
                <button onClick={() => openNamed("items")} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
                  <IdentificationCardIcon className="size-4 text-muted-foreground" />
                  {i.name}
                  <span className="text-xs text-muted-foreground">Item</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function RenameProject({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Rename project" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          try {
            await api(`/projects/${detail.id}`, "PATCH", { name: f.get("name"), description: f.get("description") })
            router.refresh()
            onClose()
          } catch (err) {
            setError(errorText(err))
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="rename-name">Name</Label>
          <Input id="rename-name" name="name" defaultValue={detail.name} maxLength={80} required autoFocus />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rename-desc">Description</Label>
          <Input id="rename-desc" name="description" defaultValue={detail.description ?? ""} maxLength={300} />
        </div>
        <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={busy}>Save</SubmitButton>
        </div>
      </form>
    </Modal>
  )
}

// Add, rename, reorder and delete environments. Each change saves at once.
function EnvManager({
  detail,
  onClose,
  onChanged,
  onGone,
}: {
  detail: Detail
  onClose: () => void
  onChanged: () => void
  onGone: (slug: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [confirm, setConfirm] = useState<Detail["envs"][number] | null>(null)
  const ids = detail.envs.map((e) => e.id)

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const move = (i: number, d: number) => {
    const order = [...ids]
    ;[order[i], order[i + d]] = [order[i + d], order[i]]
    return act(() => api(`/projects/${detail.id}/envs`, "PUT", { order }))
  }

  return (
    <Modal title="Environments" description="Development, Staging and Production start with every project. Their order here is the order of the Overview columns." onClose={onClose}>
      <ul className="flex flex-col divide-y rounded-lg border">
        {detail.envs.map((e, i) => (
          <li key={e.id} className="flex items-center gap-1 px-2 py-1.5">
            <form
              className="min-w-0 flex-1"
              onSubmit={(ev) => {
                ev.preventDefault()
                const v = String(new FormData(ev.currentTarget).get("name"))
                if (v.trim() && v !== e.name) act(() => api(`/projects/${detail.id}/envs/${e.id}`, "PATCH", { name: v }))
              }}
            >
              <Input
                aria-label={`Name of ${e.name}`}
                name="name"
                defaultValue={e.name}
                maxLength={40}
                className="h-8 border-transparent bg-transparent shadow-none"
                onBlur={(ev) => ev.currentTarget.form?.requestSubmit()}
              />
            </form>
            <span className="hidden font-mono text-xs text-muted-foreground sm:block" title="Used in ${env.KEY} references">{e.slug}</span>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${e.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUpIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${e.name} down`} disabled={i === detail.envs.length - 1} onClick={() => move(i, 1)}>
              <ArrowDownIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${e.name}`} disabled={detail.envs.length <= 1} onClick={() => setConfirm(e)}>
              <TrashIcon />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          act(async () => {
            await api(`/projects/${detail.id}/envs`, "POST", { name })
            setName("")
          })
        }}
      >
        <Input aria-label="New environment name" placeholder="New environment, e.g. QA" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <Button type="submit" variant="outline" disabled={!name.trim()}>
          <PlusIcon />
          Add
        </Button>
      </form>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
      {confirm && (
        <Confirm
          title={`Delete ${confirm.name}?`}
          description="Its folders and every secret in it are deleted for good (they don't go to the trash). Other environments aren't touched."
          action="Delete environment"
          danger
          run={async () => {
            await api(`/projects/${detail.id}/envs/${confirm.id}`, "DELETE")
            onGone(confirm.slug)
            onChanged()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  )
}
