"use client"

import { UsersIcon } from "@phosphor-icons/react"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import { getPartner, invitePartner, updatePartner } from "@/app/(app)/photo-actions"
import { findMembers } from "@/app/(app)/share-actions"
import { MENU_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import type { PartnerPatch, PartnerResponse, PartnerShare } from "@nimbus/shared/api"

type Member = Awaited<ReturnType<typeof findMembers>>[number]

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
const toDateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "")

function Who({ s, sub }: { s: PartnerShare; sub: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <UserAvatar name={s.person.name} image={s.person.image} size={36} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{s.person.name}</span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </div>
  )
}

// Partner sharing: who sees my photos, and whose photos I see.
export function PartnerSettings({ first }: { first: PartnerResponse }) {
  const [state, setState] = useState(first)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const { outgoing, incoming } = state

  function act(task: () => Promise<{ error?: string }>) {
    setError(null)
    start(async () => {
      const res = await task()
      if (res.error) setError(res.error)
      setState(await getPartner())
    })
  }
  const patch = (p: PartnerPatch) => act(() => updatePartner(p))

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {incoming.length > 0 && (
        <section aria-label="Photos shared with you" className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Shared with you</h3>
          {incoming.map((s) => (
            <div key={s.person.id} className="flex flex-col gap-3 rounded-lg border p-3">
              {s.status === "pending" ? (
                <>
                  <Who s={s} sub={`${s.person.email} · wants to share their photos with you`} />
                  <div className="flex flex-wrap gap-2">
                    {!outgoing && (
                      <Button
                        disabled={pending}
                        onClick={() => patch({ userId: s.person.id, accept: true, shareBack: true })}
                      >
                        Accept and share mine back
                      </Button>
                    )}
                    <Button
                      variant={outgoing ? "default" : "outline"}
                      disabled={pending}
                      onClick={() => patch({ userId: s.person.id, accept: true })}
                    >
                      Accept
                    </Button>
                    <Button variant="ghost" disabled={pending} onClick={() => patch({ userId: s.person.id, decline: true })}>
                      Decline
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Who s={s} sub={s.since ? `${s.person.email} · photos from ${day(s.since)}` : `${s.person.email} · all photos`} />
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => patch({ userId: s.person.id, decline: true })}>
                      Stop receiving
                    </Button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={!s.hidden}
                      disabled={pending}
                      onChange={(e) => patch({ userId: s.person.id, hidden: !e.target.checked })}
                      className="size-4 accent-primary"
                    />
                    Show their photos in my Photos
                  </label>
                </>
              )}
            </div>
          ))}
        </section>
      )}

      <section aria-label="Your photos" className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Your photos</h3>
        {outgoing ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Who
                s={outgoing}
                sub={
                  outgoing.status === "pending"
                    ? `${outgoing.person.email} · waiting for them to accept`
                    : `${outgoing.person.email} · sees your photos`
                }
              />
              <Button variant="outline" size="sm" disabled={pending} onClick={() => patch({ userId: outgoing.person.id, stop: true })}>
                Stop sharing
              </Button>
            </div>
            <Since share={outgoing} pending={pending} onChange={(since) => patch({ userId: outgoing.person.id, since })} />
          </div>
        ) : (
          <Invite pending={pending} act={act} />
        )}
      </section>
    </div>
  )
}

// "All photos" or "Only from": a change applies to what they see from now on.
function Since({
  share,
  pending,
  onChange,
}: {
  share: PartnerShare
  pending: boolean
  onChange: (since: string | null) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={id}>Photos taken since</label>
      <Input
        id={id}
        type="date"
        disabled={pending}
        value={toDateInput(share.since)}
        onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null)}
        className="w-40 [color-scheme:dark]"
      />
      {share.since ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onChange(null)}>
          All photos
        </Button>
      ) : (
        <span className="text-muted-foreground">All photos</span>
      )}
    </div>
  )
}

function Invite({ pending, act }: { pending: boolean; act: (task: () => Promise<{ error?: string }>) => void }) {
  const [q, setQ] = useState("")
  const [since, setSince] = useState("")
  const [matches, setMatches] = useState<Member[]>([])
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<Member | null>(null)
  const listId = useId()
  const sinceId = useId()
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
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!picked) return
        const userId = picked.id
        act(async () => {
          const res = await invitePartner({
            userId,
            since: since ? new Date(`${since}T00:00:00`).toISOString() : null,
          })
          if (!res.error) {
            setQ("")
            setPicked(null)
            setSince("")
          }
          return res
        })
      }}
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <UsersIcon className="size-4" />
        Nobody sees your photos yet. They get an invite and choose to accept.
      </p>
      <div className="relative">
        <Input
          role="combobox"
          aria-expanded={found.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={found.length ? `${listId}-${active}` : undefined}
          aria-label="Invite a partner"
          placeholder="Find a member by name"
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={sinceId}>Only photos taken since</label>
        <Input
          id={sinceId}
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="w-40 [color-scheme:dark]"
        />
        <span className="text-muted-foreground">{since ? "" : "Blank: all photos"}</span>
      </div>
      <div>
        <Button type="submit" disabled={!picked || pending}>
          Invite
        </Button>
      </div>
    </form>
  )
}
