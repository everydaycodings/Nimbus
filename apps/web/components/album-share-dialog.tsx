"use client"

import { Dialog } from "@base-ui/react/dialog"
import { CircleNotchIcon, LinkSimpleIcon, LockSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react"

import {
  createAlbumLink,
  getAlbumShares,
  removeAlbumShare,
  shareAlbum,
  updateAlbumShare,
} from "@/app/(app)/photo-actions"
import { findMembers } from "@/app/(app)/share-actions"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import type { AlbumLink, AlbumPerson, AlbumSharePatch, AlbumSharesResponse } from "@nimbus/shared/api"

type Member = Awaited<ReturnType<typeof findMembers>>[number]
type Role = "viewer" | "contributor"
type Act = (task: () => Promise<{ error?: string } | void>) => void

const SELECT =
  "h-9 rounded-md border border-input bg-input/30 px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const ROLES: [Role, string][] = [
  ["viewer", "Viewer"],
  ["contributor", "Contributor"],
]

// People (viewer or contributor) and public links for one album. Modelled on ShareDialog.
export function AlbumShareDialog({
  albumId,
  name,
  open,
  onClose,
}: {
  albumId: string
  name: string
  open: boolean
  onClose: () => void
}) {
  const [state, setState] = useState<AlbumSharesResponse | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const load = useCallback(() => {
    getAlbumShares(albumId).then(setState, () => setState(null))
  }, [albumId])
  useEffect(() => {
    if (open) load()
  }, [open, load])

  const act: Act = (task) => {
    setError(null)
    start(async () => {
      const res = await task()
      if (res?.error) setError(res.error)
      load()
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-lg gap-0 overflow-y-auto p-0")}>
          <header className="flex items-start gap-3 px-6 pt-6 pb-4">
            <Dialog.Title className="min-w-0 flex-1 text-base font-semibold">
              <span className="block truncate">Share “{name}”</span>
            </Dialog.Title>
            {pending && (
              <CircleNotchIcon aria-label="Saving" className="mt-1 size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
            )}
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" className="-mt-1 -mr-2" />}>
              <XIcon />
            </Dialog.Close>
          </header>
          {state === undefined ? (
            <p className="flex items-center gap-2 px-6 pb-6 text-sm text-muted-foreground">
              <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" />
              Loading…
            </p>
          ) : state === null ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Only the owner can share this album.</p>
          ) : (
            <>
              <section className="flex flex-col gap-3 px-6 pb-5">
                <AddPeople albumId={albumId} act={act} pending={pending} />
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </section>
              <section aria-labelledby="album-people" className="flex flex-col gap-1 border-t px-6 py-4">
                <h3 id="album-people" className="pb-1 text-sm font-medium text-muted-foreground">
                  People with access
                </h3>
                {state.people.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Viewers see the photos. Contributors can also add their own.
                  </p>
                )}
                {state.people.map((p) => (
                  <PersonRow key={p.shareId} p={p} albumId={albumId} act={act} />
                ))}
              </section>
              <section aria-labelledby="album-links" className="flex flex-col gap-2 border-t px-6 py-4">
                <Links albumId={albumId} links={state.links} act={act} pending={pending} />
              </section>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AddPeople({ albumId, act, pending }: { albumId: string; act: Act; pending: boolean }) {
  const [q, setQ] = useState("")
  const [role, setRole] = useState<Role>("viewer")
  const [matches, setMatches] = useState<Member[]>([])
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<Member | null>(null)
  const listId = useId()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const searching = !picked && q.trim().length >= 2
  const found = searching ? matches : []

  useEffect(() => {
    clearTimeout(timer.current)
    if (!searching) return
    timer.current = setTimeout(() => {
      findMembers(q).then((m) => {
        setMatches(m)
        setActive(0)
      })
    }, 150)
  }, [q, searching])

  function pick(m: Member) {
    setPicked(m)
    setQ(m.name)
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!picked) return
        const id = picked.id
        act(async () => {
          const res = await shareAlbum(albumId, id, role)
          if (!res.error) {
            setQ("")
            setPicked(null)
          }
          return res
        })
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Input
          role="combobox"
          aria-expanded={found.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={found.length ? `${listId}-${active}` : undefined}
          aria-label="Add people"
          placeholder="Add people by name"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPicked(null)
          }}
          onKeyDown={(e) => {
            if (!found.length) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setActive((active + 1) % found.length)
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((active - 1 + found.length) % found.length)
            } else if (e.key === "Enter") {
              e.preventDefault()
              pick(found[active])
            } else if (e.key === "Escape") {
              e.stopPropagation()
              setMatches([])
            }
          }}
        />
        {found.length > 0 && (
          <ul id={listId} role="listbox" className={cn(MENU_POPUP, "absolute inset-x-0 top-full z-10 mt-1 max-h-64")}>
            {found.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(m)
                }}
                onMouseEnter={() => setActive(i)}
                className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 aria-selected:bg-accent"
              >
                <UserAvatar name={m.name} image={m.image} size={24} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={SELECT}>
        {ROLES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={!picked || pending}>
        Share
      </Button>
    </form>
  )
}

function PersonRow({ p, albumId, act }: { p: AlbumPerson; albumId: string; act: Act }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <UserAvatar name={p.name} image={p.image} size={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{p.name}</span>
        <span className="truncate text-xs text-muted-foreground">{p.email}</span>
      </span>
      <select
        aria-label={`Role for ${p.name}`}
        value={p.role}
        onChange={(e) => act(() => updateAlbumShare(albumId, p.shareId, { role: e.target.value as Role }))}
        className={SELECT}
      >
        {ROLES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${p.name}`}
        onClick={() => act(() => removeAlbumShare(albumId, p.shareId))}
      >
        <XIcon />
      </Button>
    </div>
  )
}

function Links({
  albumId,
  links,
  act,
  pending,
}: {
  albumId: string
  links: AlbumLink[]
  act: Act
  pending: boolean
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <h3 id="album-links" className="flex-1 text-sm font-medium text-muted-foreground">
          Public links
        </h3>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => createAlbumLink(albumId))}>
          <PlusIcon />
          New link
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Anyone with a link can see the photos without signing in. Locations are never shown.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <LinkCard key={l.shareId} link={l} albumId={albumId} act={act} />
          ))}
        </ul>
      )}
    </>
  )
}

const toDateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "")

function LinkCard({ link, albumId, act }: { link: AlbumLink; albumId: string; act: Act }) {
  const [name, setName] = useState(link.name ?? "")
  const [password, setPassword] = useState("")
  const [now] = useState(Date.now)
  const nameId = useId()
  const expId = useId()
  const pwId = useId()
  const patch = (p: AlbumSharePatch) => act(() => updateAlbumShare(albumId, link.shareId, p))
  const url = `${window.location.origin}/a/${link.token}`
  const expired = link.expiresAt && Date.parse(link.expiresAt) < now
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <LinkSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{link.name}</span>
          {link.hasPassword && <LockSimpleIcon aria-label="Password protected" className="size-3.5 shrink-0 text-muted-foreground" />}
        </span>
        <CopyButton value={url} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${link.name}`}
          onClick={() => act(() => removeAlbumShare(albumId, link.shareId))}
        >
          <TrashIcon />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={nameId} className="text-xs font-medium">
            Name
          </label>
          <Input
            id={nameId}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== link.name && patch({ name })}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={expId} className="text-xs font-medium">
            Expires
          </label>
          <div className="flex gap-1.5">
            <Input
              id={expId}
              type="date"
              min={new Date(now + 864e5).toLocaleDateString("en-CA")}
              value={toDateInput(link.expiresAt)}
              onChange={(e) =>
                e.target.value && patch({ expiresAt: new Date(`${e.target.value}T23:59:59`).toISOString() })
              }
              className="[color-scheme:dark]"
            />
            {link.expiresAt && (
              <Button variant="ghost" size="icon" aria-label="Never expire" title="Never expire" onClick={() => patch({ expiresAt: null })}>
                <XIcon />
              </Button>
            )}
          </div>
          {expired && <p className="text-xs text-destructive">Expired</p>}
        </div>
      </div>
      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          patch({ password })
          setPassword("")
        }}
      >
        <label htmlFor={pwId} className="text-xs font-medium">
          Password
        </label>
        <div className="flex gap-1.5">
          <Input
            id={pwId}
            type="password"
            autoComplete="new-password"
            placeholder={link.hasPassword ? "Set a new password" : "No password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!password}>
            {link.hasPassword ? "Change" : "Set"}
          </Button>
          {link.hasPassword && (
            <Button type="button" variant="ghost" onClick={() => patch({ password: "" })}>
              Remove
            </Button>
          )}
        </div>
      </form>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={link.allowDownload}
          onChange={(e) => patch({ allowDownload: e.target.checked })}
          className="size-4 accent-primary"
        />
        Allow downloads
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {link.views} {link.views === 1 ? "view" : "views"}
        </span>
      </label>
    </li>
  )
}
