"use client"

import {
  FolderSimplePlusIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import type {
  DocSender,
  DocType,
  DocWatchFolder,
} from "@nimbus/shared/documents-api"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  addDocWatch,
  mergeSender,
  removeDocType,
  removeDocWatch,
  removeSender,
  renameSender,
  saveDocType,
} from "@/app/(app)/documents/actions"
import { SELECT } from "@/components/admin/setting-styles"
import { MoveDialog } from "@/components/move-dialog"
import { useNotice } from "@/components/toaster"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Result = { error?: string }

// The user's own document types (with how early to remind), the senders Nimbus learned, and watched and not watched folders.
export function DocumentsSettings({
  types,
  senders,
  watch,
  ignored,
}: {
  types: DocType[]
  senders: DocSender[]
  watch: DocWatchFolder[]
  ignored: DocWatchFolder[]
}) {
  const router = useRouter()
  const notice = useNotice()
  const [busy, setBusy] = useState(false)

  // One change at a time; says what went wrong, then reloads.
  async function act(task: () => Promise<Result>, done?: string) {
    setBusy(true)
    try {
      const r = await task()
      if (r.error) notice({ text: r.error, error: true })
      else {
        if (done) notice({ text: done })
        router.refresh()
      }
      return !r.error
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <TypesCard types={types} act={act} busy={busy} />
      <SendersCard senders={senders} act={act} busy={busy} />
      <WatchCard watch={watch} act={act} busy={busy} />
      <WatchCard watch={ignored} ignore act={act} busy={busy} />
    </div>
  )
}

type Act = (task: () => Promise<Result>, done?: string) => Promise<boolean>

const days = (v: string) =>
  v.trim() === "" ? null : Math.max(0, Math.round(Number(v)) || 0)

function TypesCard({
  types,
  act,
  busy,
}: {
  types: DocType[]
  act: Act
  busy: boolean
}) {
  const [name, setName] = useState("")
  const [lead, setLead] = useState("")
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Types</CardTitle>
        <CardDescription>
          Each type reminds you this many days before a document&apos;s expiry
          or due date. A single document can use its own number. Leave it empty
          for no reminder.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y rounded-lg border">
          {types.map((t) => (
            <TypeRow
              key={`${t.id}:${t.name}:${t.remindDays}`}
              type={t}
              act={act}
              busy={busy}
            />
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (
              await act(
                () =>
                  saveDocType({ name: name.trim(), remindDays: days(lead) }),
                "Type added."
              )
            ) {
              setName("")
              setLead("")
            }
          }}
        >
          <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            New type
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lease, Permit…"
              maxLength={60}
              required
            />
          </label>
          <label className="flex w-32 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Remind (days)
            <Input
              type="number"
              min={0}
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              placeholder="None"
              className="tabular-nums"
            />
          </label>
          <Button type="submit" disabled={busy || !name.trim()}>
            <PlusIcon />
            Add type
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function TypeRow({
  type,
  act,
  busy,
}: {
  type: DocType
  act: Act
  busy: boolean
}) {
  const [name, setName] = useState(type.name)
  const [lead, setLead] = useState(
    type.remindDays === null ? "" : String(type.remindDays)
  )
  const dirty = name.trim() !== type.name || days(lead) !== type.remindDays
  return (
    <li className="flex flex-wrap items-center gap-2 p-2.5">
      {type.preset ? (
        <>
          <span className="min-w-0 flex-1 truncate px-1 text-sm">
            {type.name}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Built in
          </span>
          <span className="w-24 text-right text-sm text-muted-foreground tabular-nums">
            {type.remindDays === null
              ? "No reminder"
              : `${type.remindDays} days`}
          </span>
        </>
      ) : (
        <>
          <Input
            aria-label={`Name of ${type.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className="min-w-40 flex-1"
          />
          <Input
            aria-label={`Reminder days for ${type.name}`}
            type="number"
            min={0}
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            placeholder="None"
            className="w-24 tabular-nums"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !dirty || !name.trim()}
            onClick={() =>
              void act(
                () =>
                  saveDocType(
                    { name: name.trim(), remindDays: days(lead) },
                    type.id
                  ),
                "Saved."
              )
            }
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${type.name}`}
            disabled={busy}
            onClick={() =>
              void act(() => removeDocType(type.id), "Type deleted.")
            }
          >
            <TrashIcon />
          </Button>
        </>
      )}
    </li>
  )
}

function SendersCard({
  senders,
  act,
  busy,
}: {
  senders: DocSender[]
  act: Act
  busy: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Senders</CardTitle>
        <CardDescription>
          Nimbus learns senders from your documents. Rename one, merge two that
          are the same company, or delete one (its documents stay, with no
          sender).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {senders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No senders yet. They appear as documents are read.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {senders.map((s) => (
              <SenderRow
                key={`${s.id}:${s.name}`}
                sender={s}
                others={senders.filter((o) => o.id !== s.id)}
                act={act}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SenderRow({
  sender,
  others,
  act,
  busy,
}: {
  sender: DocSender
  others: DocSender[]
  act: Act
  busy: boolean
}) {
  const [name, setName] = useState(sender.name)
  return (
    <li className="flex flex-wrap items-center gap-2 p-2.5">
      <Input
        aria-label={`Name of ${sender.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        className="min-w-40 flex-1"
      />
      <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
        {sender.count} {sender.count === 1 ? "document" : "documents"}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !name.trim() || name.trim() === sender.name}
        onClick={() =>
          void act(() => renameSender(sender.id, name.trim()), "Renamed.")
        }
      >
        Rename
      </Button>
      <select
        aria-label={`Merge ${sender.name} into`}
        value=""
        disabled={busy || others.length === 0}
        onChange={(e) => {
          const into = others.find((o) => o.id === e.target.value)
          if (
            into &&
            window.confirm(
              `Merge “${sender.name}” into “${into.name}”? Their documents move to “${into.name}”.`
            )
          )
            void act(
              () => mergeSender(sender.id, into.id),
              `Merged into ${into.name}.`
            )
        }}
        className={cn(SELECT, "h-8 w-36")}
      >
        <option value="">Merge into…</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${sender.name}`}
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              `Delete the sender “${sender.name}”? Its documents stay, with no sender.`
            )
          )
            void act(() => removeSender(sender.id), "Sender deleted.")
        }}
      >
        <TrashIcon />
      </Button>
    </li>
  )
}

// What each folder list says: watched (everything counts) or not watched (nothing counts).
const LISTS = {
  watch: {
    title: "Watched folders",
    about:
      "Everything you put in these folders, or in the Documents folder, counts as a document and lands in Needs review. PDFs count wherever they are.",
    remove: "Stop watching",
    removed: "No longer watched.",
    add: "Watch a folder",
    pick: "Watch which folder?",
    action: "Watch this folder",
    added: (n: string) => `Watching ${n}.`,
  },
  ignore: {
    title: "Not watched",
    about:
      "Nothing in these folders, or the folders inside them, is found as a document, not even PDFs. Files you mark as a document by hand still count. Guesses waiting in Needs review leave when you add a folder.",
    remove: "Watch again",
    removed: "Files there can be found again.",
    add: "Add a folder",
    pick: "Which folder should Documents skip?",
    action: "Skip this folder",
    added: (n: string) => `Documents skips ${n}.`,
  },
}

function WatchCard({
  watch,
  ignore = false,
  act,
  busy,
}: {
  watch: DocWatchFolder[]
  ignore?: boolean
  act: Act
  busy: boolean
}) {
  const notice = useNotice()
  const [picking, setPicking] = useState(false)
  const t = LISTS[ignore ? "ignore" : "watch"]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>{t.about}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {watch.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {watch.map((w) => (
              <li key={w.id} className="flex items-center gap-2 p-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {w.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {w.path}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${t.remove} ${w.name}`}
                  disabled={busy}
                  onClick={() => void act(() => removeDocWatch(w.id), t.removed)}
                >
                  <TrashIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="self-start"
          disabled={busy}
          onClick={() => setPicking(true)}
        >
          <FolderSimplePlusIcon />
          {t.add}
        </Button>
        <MoveDialog
          open={picking}
          title={t.pick}
          action={t.action}
          moving={[]}
          start={[{ id: null, name: "My files" }]}
          onClose={() => setPicking(false)}
          onMove={(to) => {
            if (!to.id)
              return notice({
                text: "Open a folder first. All of My files can't be picked.",
                error: true,
              })
            setPicking(false)
            void act(() => addDocWatch(to.id!, ignore), t.added(to.name))
          }}
        />
      </CardContent>
    </Card>
  )
}
