"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  CaretDownIcon,
  CaretRightIcon,
  CircleNotchIcon,
  CrownSimpleIcon,
  EnvelopeSimpleIcon,
  LinkSimpleIcon,
  LockSimpleIcon,
  PlusIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"

import {
  cancelOwnershipOffer,
  createLink,
  deleteLink,
  findMembers,
  getShareState,
  listLinkEvents,
  offerOwnership,
  removeShare,
  setAllowReshare,
  setShareRole,
  shareWith,
  updateLink,
  type LinkEvent,
  type LinkInfo,
  type LinkPatch,
  type Person,
  type ShareState,
} from "@/app/(app)/share-actions"
import { CopyButton } from "@/components/copy-button"
import {
  DIALOG_BACKDROP,
  DIALOG_POPUP,
  MENU_ITEM,
  MENU_POPUP,
} from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UserAvatar } from "@/components/user-avatar"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"

type Role = "viewer" | "editor"
type Member = Awaited<ReturnType<typeof findMembers>>[number]

const SELECT =
  "h-9 rounded-md border border-input bg-input/30 px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", editor: "Editor" }
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

// Drive-style sharing: people first, then any number of public links.
export function ShareDialog({
  item,
  onClose,
}: {
  item: Item | null
  onClose: () => void
}) {
  // Kept while the dialog animates out.
  const [shown, setShown] = useState(item)
  const [state, setState] = useState<ShareState | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  if (item && item !== shown) {
    setShown(item)
    setState(undefined)
    setError(null)
  }
  const [pending, start] = useTransition()
  const id = shown?.id

  const load = useCallback(() => {
    if (!id) return
    getShareState(id).then(setState, () => setState(null))
  }, [id])

  useEffect(() => {
    if (item) load()
  }, [item, load])

  // Runs a change, shows its error inline, then reloads what's shown.
  function act(task: () => Promise<{ error?: string } | void>) {
    setError(null)
    start(async () => {
      const res = await task()
      if (res?.error) setError(res.error)
      load()
    })
  }

  return (
    <Dialog.Root open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup
          className={cn(
            DIALOG_POPUP,
            "max-h-[calc(100svh-2rem)] max-w-lg gap-0 overflow-y-auto p-0"
          )}
        >
          <header className="flex items-start gap-3 px-6 pt-6 pb-4">
            <Dialog.Title className="min-w-0 flex-1 text-base font-semibold">
              <span className="block truncate">Share “{shown?.name}”</span>
            </Dialog.Title>
            {pending && (
              <CircleNotchIcon
                aria-label="Saving"
                className="mt-1 size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
              />
            )}
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  className="-mt-1 -mr-2"
                />
              }
            >
              <XIcon />
            </Dialog.Close>
          </header>

          {state === undefined ? (
            <p className="flex items-center gap-2 px-6 pb-6 text-sm text-muted-foreground">
              <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" />
              Loading…
            </p>
          ) : state === null ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              You can&apos;t share this. Its owner may have turned sharing off
              for editors.
            </p>
          ) : (
            <Body
              nodeId={id!}
              state={state}
              act={act}
              pending={pending}
              error={error}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type Act = (task: () => Promise<{ error?: string } | void>) => void

function Body({
  nodeId,
  state,
  act,
  pending,
  error,
}: {
  nodeId: string
  state: ShareState
  act: Act
  pending: boolean
  error: string | null
}) {
  const [openLink, setOpenLink] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [askingPassword, setAskingPassword] = useState(false)

  function newLink() {
    if (state.requireLinkPassword && !askingPassword) {
      setAskingPassword(true)
      return
    }
    act(async () => {
      const res = await createLink(nodeId, { password: newPassword })
      if (res.id) {
        setOpenLink(res.id)
        setAskingPassword(false)
        setNewPassword("")
      }
      return res
    })
  }

  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 px-6 pb-5">
        <AddPeople nodeId={nodeId} state={state} act={act} pending={pending} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <section
        aria-labelledby="people-heading"
        className="flex flex-col gap-1 border-t px-6 py-4"
      >
        <h3
          id="people-heading"
          className="pb-1 text-sm font-medium text-muted-foreground"
        >
          People with access
        </h3>
        <div className="flex items-center gap-3 py-1.5">
          <UserAvatar
            name={state.owner.name}
            image={state.owner.image}
            size={32}
          />
          <PersonText
            name={state.owner.name + (state.isOwner ? " (you)" : "")}
            sub={state.owner.email}
          />
          <span className="text-sm text-muted-foreground">Owner</span>
        </div>
        {state.people.map((p) => (
          <PersonRow
            key={p.shareId + (p.through ?? "")}
            p={p}
            isOwner={state.isOwner}
            act={act}
            nodeId={nodeId}
          />
        ))}
        {state.transferTo && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <CrownSimpleIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              Waiting for {state.transferTo.name} to accept ownership.
            </span>
            {state.isOwner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => act(() => cancelOwnershipOffer(nodeId))}
              >
                Cancel offer
              </Button>
            )}
          </p>
        )}
        {state.isOwner && (
          <label className="mt-2 flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={state.allowReshare}
              onChange={(e) =>
                act(() => setAllowReshare(nodeId, e.target.checked))
              }
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Editors can share it too
              <span className="block text-muted-foreground">
                Off: only you can add people or make links
                {state.kind === "folder" ? ", here and inside" : ""}.
              </span>
            </span>
          </label>
        )}
      </section>

      <section
        aria-labelledby="links-heading"
        className="flex flex-col gap-2 border-t px-6 py-4"
      >
        <div className="flex items-center gap-2">
          <h3
            id="links-heading"
            className="flex-1 text-sm font-medium text-muted-foreground"
          >
            Public links
          </h3>
          {state.publicLinks && (
            <Button
              variant="outline"
              size="sm"
              onClick={newLink}
              disabled={pending}
            >
              <PlusIcon />
              New link
            </Button>
          )}
        </div>
        {askingPassword && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              newLink()
            }}
          >
            <Input
              type="password"
              autoFocus
              autoComplete="new-password"
              placeholder="Password for the new link"
              aria-label="Password for the new link"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button type="submit" disabled={!newPassword || pending}>
              Create
            </Button>
          </form>
        )}
        {!state.publicLinks && (
          <p className="text-sm text-muted-foreground">
            Your admin turned public links off
            {state.links.length ? ", so these links don't open." : "."}
          </p>
        )}
        {state.publicLinks && !state.links.length && !askingPassword && (
          <p className="text-sm text-muted-foreground">
            Anyone with a link can{" "}
            {state.kind === "folder" ? "browse this folder" : "open this file"}{" "}
            without signing in. Each link gets its own expiry, password and
            permissions.
          </p>
        )}
        {state.links.length > 0 && (
          <ul className="-mx-2 flex flex-col">
            {state.links.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                kind={state.kind}
                maxLinkDays={state.maxLinkDays}
                requirePassword={state.requireLinkPassword}
                open={openLink === l.id}
                onToggle={() => setOpenLink(openLink === l.id ? null : l.id)}
                act={act}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// Member autocomplete or a plain email, a role, and Share.
function AddPeople({
  nodeId,
  state,
  act,
  pending,
}: {
  nodeId: string
  state: ShareState
  act: Act
  pending: boolean
}) {
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

  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.trim())
  const ready = Boolean(picked) || email

  function pick(m: Member) {
    setPicked(m)
    setQ(m.name)
  }

  function submit() {
    if (!ready) return
    const target = picked?.id ?? q.trim()
    act(async () => {
      const res = await shareWith(nodeId, target, role)
      if (!res.error) {
        setQ("")
        setPicked(null)
      }
      return res
    })
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            role="combobox"
            aria-expanded={found.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              found.length ? `${listId}-${active}` : undefined
            }
            aria-label="Add people"
            placeholder={
              state.canInvite && state.emailOn
                ? "Add people by name or email"
                : "Add people by name"
            }
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
            <ul
              id={listId}
              role="listbox"
              className={cn(
                MENU_POPUP,
                "absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto"
              )}
            >
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
                  <PersonText name={m.name} sub={m.email} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className={SELECT}
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
        <Button type="submit" disabled={!ready || pending}>
          Share
        </Button>
      </div>
      {email && !picked && (
        <p className="text-xs text-muted-foreground">
          {state.canInvite && state.emailOn
            ? "If they don't have an account, they'll get an email invite to join."
            : "They need an account on this Nimbus first."}
        </p>
      )}
    </form>
  )
}

function PersonText({ name, sub }: { name: string; sub: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="truncate text-xs text-muted-foreground">{sub}</span>
    </span>
  )
}

function PersonRow({
  p,
  isOwner,
  act,
  nodeId,
}: {
  p: Person
  isOwner: boolean
  act: Act
  nodeId: string
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {p.invited ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <EnvelopeSimpleIcon className="size-4" />
        </span>
      ) : (
        <UserAvatar name={p.name} image={p.image} size={32} />
      )}
      <PersonText
        name={p.invited ? p.email : p.name}
        sub={
          p.invited
            ? "Invited, no account yet"
            : p.through
              ? `${p.email} · through “${p.through}”`
              : p.email
        }
      />
      {!p.canManage ? (
        <span className="text-sm text-muted-foreground">
          {ROLE_LABEL[p.role]}
        </span>
      ) : (
        <Menu.Root>
          <Menu.Trigger
            render={<Button variant="ghost" size="sm" className="-mr-2" />}
          >
            {ROLE_LABEL[p.role]}
            <CaretDownIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={4}>
              <Menu.Popup className={`w-48 ${MENU_POPUP}`}>
                <Menu.RadioGroup
                  value={p.role}
                  onValueChange={(r) =>
                    act(() => setShareRole(p.shareId, r as Role))
                  }
                >
                  {(["viewer", "editor"] as const).map((r) => (
                    <Menu.RadioItem
                      key={r}
                      value={r}
                      className={cn(MENU_ITEM, "relative pl-8")}
                    >
                      <Menu.RadioItemIndicator className="absolute left-2.5 size-1.5 rounded-full bg-foreground" />
                      {ROLE_LABEL[r]}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
                <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
                {isOwner && p.userId && (
                  <Menu.Item
                    className={MENU_ITEM}
                    onClick={() => act(() => offerOwnership(nodeId, p.userId!))}
                  >
                    <CrownSimpleIcon />
                    Offer ownership
                  </Menu.Item>
                )}
                <Menu.Item
                  className={cn(
                    MENU_ITEM,
                    "text-destructive [&_svg]:text-destructive"
                  )}
                  onClick={() => act(() => removeShare(p.shareId))}
                >
                  <TrashIcon />
                  Remove access
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  )
}

function expiryLabel(iso: string | null) {
  if (!iso) return null
  const at = new Date(iso)
  return at.getTime() < Date.now() ? "Expired" : `Until ${date.format(at)}`
}

function LinkRow({
  link,
  kind,
  maxLinkDays,
  requirePassword,
  open,
  onToggle,
  act,
}: {
  link: LinkInfo
  kind: "file" | "folder"
  maxLinkDays: number | null
  requirePassword: boolean
  open: boolean
  onToggle: () => void
  act: Act
}) {
  // The dialog only renders in the browser, after it's opened.
  const url = `${window.location.origin}/s/${link.token}`
  const [now] = useState(Date.now)
  const expired = link.expiresAt && Date.parse(link.expiresAt) < now
  const chips = [
    expiryLabel(link.expiresAt),
    !link.allowView && "Uploads only",
    link.allowView && !link.allowDownload && "No download",
    link.allowUpload && link.allowView && "Takes uploads",
  ].filter(Boolean) as string[]

  return (
    <li
      className="flex flex-col rounded-lg data-open:bg-muted/30"
      data-open={open || undefined}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            {link.allowUpload && !link.allowView ? (
              <UploadSimpleIcon className="size-4" />
            ) : (
              <LinkSimpleIcon className="size-4" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{link.name}</span>
              {link.hasPassword && (
                <LockSimpleIcon
                  aria-label="Password protected"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              )}
            </span>
            <span
              className={cn(
                "truncate text-xs text-muted-foreground",
                expired && "text-destructive"
              )}
            >
              {chips.length ? chips.join(" · ") : "Anyone with the link"}
            </span>
          </span>
          <CaretRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
        </button>
        <CopyButton value={url} />
      </div>
      {open && (
        <LinkSettings
          link={link}
          kind={kind}
          maxLinkDays={maxLinkDays}
          requirePassword={requirePassword}
          act={act}
        />
      )}
    </li>
  )
}

const toDateInput = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA") : ""

function LinkSettings({
  link,
  kind,
  maxLinkDays,
  requirePassword,
  act,
}: {
  link: LinkInfo
  kind: "file" | "folder"
  maxLinkDays: number | null
  requirePassword: boolean
  act: Act
}) {
  const [name, setName] = useState(link.name)
  const [password, setPassword] = useState("")
  const [cap, setCap] = useState(
    link.uploadCapBytes
      ? String(+(link.uploadCapBytes / 2 ** 30).toFixed(2))
      : ""
  )
  const [events, setEvents] = useState<LinkEvent[] | null>(null)
  const [all, setAll] = useState(false)
  const nameId = useId()
  const expId = useId()
  const pwId = useId()
  const capId = useId()

  useEffect(() => {
    listLinkEvents(link.id, all ? 500 : 20).then(setEvents)
  }, [link.id, all, link.viewCount, link.downloadCount])

  const patch = (p: LinkPatch) => act(() => updateLink(link.id, p))
  const [now] = useState(Date.now)
  const day = (n: number) =>
    new Date(now + n * 864e5).toLocaleDateString("en-CA")
  const max = maxLinkDays ? day(maxLinkDays) : undefined

  return (
    <div className="flex flex-col gap-4 px-2 pt-2 pb-3">
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
            onBlur={() => name.trim() !== link.name && patch({ name })}
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
              min={day(1)}
              max={max}
              value={toDateInput(link.expiresAt)}
              onChange={(e) =>
                e.target.value &&
                patch({
                  // End of the chosen day, local time.
                  expiresAt: new Date(
                    `${e.target.value}T23:59:59`
                  ).toISOString(),
                })
              }
              className="[color-scheme:dark]"
            />
            {link.expiresAt && !maxLinkDays && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Never expire"
                title="Never expire"
                onClick={() => patch({ expiresAt: null })}
              >
                <XIcon />
              </Button>
            )}
          </div>
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
            placeholder={
              link.hasPassword ? "Set a new password" : "No password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!password}>
            {link.hasPassword ? "Change" : "Set"}
          </Button>
          {link.hasPassword && !requirePassword && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => patch({ password: "" })}
            >
              Remove
            </Button>
          )}
        </div>
        {link.hasPassword && (
          <p className="text-xs text-muted-foreground">
            Changing it signs out everyone who unlocked the link.
          </p>
        )}
      </form>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="pb-1.5 text-xs font-medium">
          People with the link can
        </legend>
        <Toggle
          checked={link.allowView}
          onChange={(on) => patch({ allowView: on })}
          label={kind === "folder" ? "See the files in it" : "See the file"}
        />
        <Toggle
          checked={link.allowDownload}
          disabled={!link.allowView}
          onChange={(on) => patch({ allowDownload: on })}
          label="Download"
          hint="Off: preview only. Anyone can still screenshot what they see."
        />
        {kind === "folder" && (
          <Toggle
            checked={link.allowUpload}
            onChange={(on) => patch({ allowUpload: on })}
            label="Upload files (file drop)"
            hint="Uploads land here, belong to you and count against your storage."
          />
        )}
        {kind === "folder" && link.allowUpload && (
          <form
            className="ml-7 flex items-end gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              patch({
                uploadCapBytes: cap.trim() ? Number(cap) * 2 ** 30 : null,
              })
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor={capId} className="text-xs text-muted-foreground">
                Stop taking uploads after (GB)
              </label>
              <Input
                id={capId}
                type="number"
                min={0.01}
                step={0.01}
                placeholder="No limit"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="w-36"
              />
            </div>
            <Button type="submit" variant="outline">
              Save
            </Button>
          </form>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {link.viewCount} {link.viewCount === 1 ? "view" : "views"} ·{" "}
          {link.downloadCount}{" "}
          {link.downloadCount === 1 ? "download" : "downloads"}
          {link.lastOpenedAt &&
            ` · last opened ${dateTime.format(new Date(link.lastOpenedAt))}`}
        </p>
        {events && events.length > 0 && (
          <ul
            aria-label="Recent activity"
            className={cn(
              "flex flex-col divide-y rounded-lg border text-xs",
              all && "max-h-64 overflow-y-auto"
            )}
          >
            {events.map((e, i) => (
              <li
                key={i}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 px-3 py-1.5"
                title={e.ua ?? undefined}
              >
                <span className="text-muted-foreground tabular-nums">
                  {dateTime.format(new Date(e.at))}
                </span>
                <span className="truncate">
                  {EVENT[e.kind] ?? e.kind}
                  {e.detail && ` “${e.detail}”`}
                  <span className="text-muted-foreground">
                    {" "}
                    · {e.ip ?? "unknown IP"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {events && events.length >= 20 && !all && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setAll(true)}
          >
            View all activity
          </Button>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="self-start text-destructive hover:text-destructive"
        onClick={() => act(() => deleteLink(link.id))}
      >
        <TrashIcon />
        Delete link
      </Button>
    </div>
  )
}

const EVENT: Record<string, string> = {
  view: "Opened",
  download: "Downloaded",
  upload: "Uploaded",
  unlock_fail: "Wrong password",
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 text-sm",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        {label}
        {hint && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  )
}
