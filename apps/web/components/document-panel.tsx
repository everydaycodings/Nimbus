"use client"

import {
  CheckCircleIcon,
  FileTextIcon,
  FileXIcon,
  PlusIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react"
import type {
  DocSender,
  DocType,
  DocumentDetail,
  DocumentPatch,
} from "@nimbus/shared/documents-api"
import { useEffect, useId, useState } from "react"

import {
  dismissDocs,
  getDocPanel,
  markDocs,
  saveDoc,
} from "@/app/(app)/documents/actions"
import { day, money } from "@/components/doc-bits"
import { useNotice } from "@/components/toaster"
import { SELECT } from "@/components/admin/setting-styles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Draft = {
  typeId: string
  sender: string
  docDate: string
  amount: string
  currency: string
  expiresAt: string
  remindDays: string
  notes: string
  fields: [string, string][]
}

const draftOf = (d: DocumentDetail): Draft => ({
  typeId: d.typeId ?? "",
  // A sender that is only guessed (not made yet) is offered in the field; it is made when you save or confirm.
  sender: d.senderName ?? (d.role === "owner" && d.status === "review" ? (d.guess.sender ?? "") : ""),
  docDate: d.docDate ?? "",
  amount: d.amount === null ? "" : String(d.amount),
  currency: d.currency ?? "",
  expiresAt: d.expiresAt ?? "",
  remindDays: d.remindOverride === null ? "" : String(d.remindOverride),
  notes: d.notes ?? "",
  fields: Object.entries(d.fields),
})

const patchOf = (d: Draft): DocumentPatch => ({
  typeId: d.typeId || null,
  senderName: d.sender.trim() || null,
  docDate: d.docDate || null,
  amount:
    d.amount.trim() === "" || Number.isNaN(Number(d.amount))
      ? null
      : Number(d.amount),
  currency: d.currency.trim().toUpperCase().slice(0, 3) || null,
  expiresAt: d.expiresAt || null,
  remindDays:
    d.remindDays.trim() === ""
      ? null
      : Math.max(0, Math.round(Number(d.remindDays)) || 0),
  notes: d.notes,
  fields: Object.fromEntries(
    d.fields.map(([k, v]) => [k.trim(), v.trim()] as const).filter(([k]) => k)
  ),
})

// The previewer's Document panel: the fields of one file, what was guessed, the file's text and Confirm.
// Read-only for a document shared with me.
export function DocumentPanel({ id, owner }: { id: string; owner: boolean }) {
  const notice = useNotice()
  const uid = useId()
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error" }
    | {
        kind: "ready"
        doc: DocumentDetail | null
        types: DocType[]
        senders: DocSender[]
      }
  >({ kind: "loading" })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    getDocPanel(id).then(
      (r) => {
        if (!live) return
        setState({ kind: "ready", ...r })
        setDraft(r.doc ? draftOf(r.doc) : null)
      },
      () => live && setState({ kind: "error" })
    )
    return () => {
      live = false
    }
  }, [id])

  if (state.kind === "loading")
    return <p className="text-sm text-muted-foreground">Loading…</p>
  if (state.kind === "error")
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load the document fields.
      </p>
    )
  const { doc, types, senders } = state

  const apply = (
    r: { error?: string; item?: DocumentDetail },
    text: string
  ) => {
    if (r.error || !r.item)
      return notice({ text: r.error ?? "Couldn't save.", error: true })
    setState({ ...state, doc: r.item })
    setDraft(draftOf(r.item))
    notice({ text })
  }
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }
  const reload = () =>
    getDocPanel(id).then((r) => {
      setState({ kind: "ready", ...r })
      setDraft(r.doc ? draftOf(r.doc) : null)
    })

  const header = (
    <div className="flex items-center gap-2">
      <FileTextIcon className="size-5 text-muted-foreground" />
      <h2 className="text-base font-semibold">Document</h2>
      {doc && doc.status !== "dismissed" && (
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
            doc.status === "review"
              ? "bg-warning/15 text-warning"
              : "bg-brand/15 text-brand"
          )}
        >
          {doc.status === "review" ? "Needs review" : "Confirmed"}
        </span>
      )}
    </div>
  )

  if (!doc || doc.status === "dismissed")
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          {!doc
            ? "This file isn't in Documents."
            : "You marked this file as not a document, so it stays out of Documents."}
        </p>
        {owner && (
          <Button
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await markDocs([id])
                if (r.error) return notice({ text: r.error, error: true })
                notice({
                  text: "Marked as a document. Its fields fill in once it has been read.",
                })
                await reload()
              })
            }
          >
            <FileTextIcon />
            {doc ? "Mark as document again" : "Mark as document"}
          </Button>
        )}
      </div>
    )

  const d = draft ?? draftOf(doc)
  const set = (p: Partial<Draft>) => setDraft({ ...d, ...p })
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(doc))
  const g = doc.guess
  const review = doc.status === "review"
  const typeKey = (k: string | null | undefined) =>
    types.find((t) => t.key === k)
  const guessType = typeKey(g.type)
  const typeDefault = types.find((t) => t.id === d.typeId)?.remindDays ?? null
  const known = senders.some(
    (s) => s.name.toLowerCase() === d.sender.trim().toLowerCase()
  )

  // "Guessed from the text" while the value is the guess, "Guessed X · Use" when it was changed.
  const hint = (
    shown: string,
    guess: string | null | undefined,
    use: () => void
  ) => {
    if (!review || !guess) return null
    return shown === guess ? (
      <p className="text-xs text-muted-foreground">Guessed from the text</p>
    ) : (
      owner && (
        <p className="text-xs text-muted-foreground">
          Guessed {guess}
          {" · "}
          <button
            type="button"
            onClick={use}
            className="rounded text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Use
          </button>
        </p>
      )
    )
  }
  const field = (
    key: string,
    label: string,
    control: React.ReactNode,
    note?: React.ReactNode,
    span = false
  ) => (
    <div className={cn("flex min-w-0 flex-col gap-1.5", span && "col-span-2")}>
      <label
        htmlFor={`${uid}-${key}`}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {control}
      {note}
    </div>
  )

  const save = (confirm: boolean) =>
    run(async () => {
      const r = await saveDoc(id, {
        ...patchOf(d),
        ...(confirm && { status: "confirmed" as const }),
      })
      apply(r, confirm ? "Confirmed." : "Saved.")
      // A new sender joins the list.
      if (!r.error)
        await getDocPanel(id).then((x) => setState({ kind: "ready", ...x }))
    })

  return (
    <form
      className="flex min-h-full flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (owner && dirty) void save(false)
      }}
    >
      {header}
      {doc.dupOf && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
        >
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            Looks like the same document as{" "}
            <span className="font-medium">{doc.dupOf.name}</span>. You may have
            it twice.
          </p>
        </div>
      )}
      {!owner && doc.owner && (
        <p className="text-sm text-muted-foreground">
          {doc.owner} shared this document. The fields are theirs and can&apos;t
          be changed here.
        </p>
      )}
      <fieldset
        disabled={!owner || busy}
        className="grid min-w-0 grid-cols-2 gap-3 disabled:opacity-100"
      >
        {field(
          "type",
          "Type",
          <select
            id={`${uid}-type`}
            value={d.typeId}
            onChange={(e) => set({ typeId: e.target.value })}
            className={SELECT}
          >
            <option value="">No type</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>,
          <>
            {hint(d.typeId, guessType?.id, () =>
              set({ typeId: guessType!.id })
            )}
            {review && !g.type && g.clip && (
              <p className="text-xs text-muted-foreground">
                Looks like{" "}
                {typeKey(g.clip.type)?.name.toLowerCase() ?? g.clip.type} (
                {Math.round(g.clip.score * 100)}% sure)
              </p>
            )}
          </>,
          true
        )}
        {field(
          "sender",
          "Sender",
          <Input
            id={`${uid}-sender`}
            list={`${uid}-senders`}
            value={d.sender}
            onChange={(e) => set({ sender: e.target.value })}
            placeholder="Who it is from"
            autoComplete="off"
          />,
          <>
            <datalist id={`${uid}-senders`}>
              {senders.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            {owner && d.sender.trim() && !known && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <PlusIcon className="size-3" />
                New sender, added when you save
              </p>
            )}
            {hint(d.sender.trim(), g.sender, () => set({ sender: g.sender! }))}
          </>,
          true
        )}
        {field(
          "date",
          "Document date",
          <Input
            id={`${uid}-date`}
            type="date"
            value={d.docDate}
            onChange={(e) => set({ docDate: e.target.value })}
          />,
          hint(d.docDate, g.date, () => set({ docDate: g.date! }))
        )}
        {field(
          "expiry",
          "Expires or due",
          <Input
            id={`${uid}-expiry`}
            type="date"
            value={d.expiresAt}
            onChange={(e) => set({ expiresAt: e.target.value })}
          />,
          hint(d.expiresAt, g.expiry, () => set({ expiresAt: g.expiry! }))
        )}
        {field(
          "amount",
          "Amount",
          <Input
            id={`${uid}-amount`}
            type="number"
            step="0.01"
            inputMode="decimal"
            value={d.amount}
            onChange={(e) => set({ amount: e.target.value })}
            className="tabular-nums"
          />,
          hint(
            d.amount,
            g.amount === null || g.amount === undefined
              ? null
              : String(g.amount),
            () => set({ amount: String(g.amount) })
          )
        )}
        {field(
          "currency",
          "Currency",
          <Input
            id={`${uid}-currency`}
            value={d.currency}
            maxLength={3}
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
            placeholder="USD"
            className="uppercase"
            autoComplete="off"
          />,
          hint(d.currency, g.currency, () => set({ currency: g.currency! }))
        )}
        {field(
          "remind",
          "Remind me before",
          <div className="flex items-center gap-2">
            <Input
              id={`${uid}-remind`}
              type="number"
              min={0}
              inputMode="numeric"
              value={d.remindDays}
              onChange={(e) => set({ remindDays: e.target.value })}
              placeholder={typeDefault === null ? "Never" : String(typeDefault)}
              className="tabular-nums"
            />
            <span className="shrink-0 text-sm text-muted-foreground">days</span>
          </div>,
          <p className="text-xs text-muted-foreground">
            {d.remindDays.trim() === ""
              ? typeDefault === null
                ? "Follows the type: no reminder."
                : `Follows the type: ${typeDefault} days.`
              : "Your own lead time."}
          </p>,
          true
        )}
        {field(
          "notes",
          "Notes",
          <textarea
            id={`${uid}-notes`}
            value={d.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={3}
            className="min-h-16 w-full resize-y rounded-md border border-input bg-input/30 px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />,
          undefined,
          true
        )}
        <div className="col-span-2 flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Other fields
          </p>
          {d.fields.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label="Field name"
                value={k}
                placeholder="Name"
                onChange={(e) =>
                  set({
                    fields: d.fields.map((f, j) =>
                      j === i ? [e.target.value, f[1]] : f
                    ),
                  })
                }
              />
              <Input
                aria-label={`Value for ${k || "field"}`}
                value={v}
                placeholder="Value"
                onChange={(e) =>
                  set({
                    fields: d.fields.map((f, j) =>
                      j === i ? [f[0], e.target.value] : f
                    ),
                  })
                }
              />
              {owner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove field"
                  onClick={() =>
                    set({ fields: d.fields.filter((_, j) => j !== i) })
                  }
                >
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
          {owner && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => set({ fields: [...d.fields, ["", ""]] })}
            >
              <PlusIcon />
              Add a field
            </Button>
          )}
          {!owner && !d.fields.length && (
            <p className="text-sm text-muted-foreground">None.</p>
          )}
        </div>
      </fieldset>
      {!owner && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {[
            doc.typeName,
            doc.senderName,
            day(doc.docDate),
            money(doc.amount, doc.currency),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <details className="group rounded-lg border bg-card/50 text-sm">
        <summary className="flex h-9 cursor-pointer items-center px-3 text-muted-foreground outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          Text read from the file
        </summary>
        <pre className="max-h-64 overflow-auto border-t px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {doc.text?.trim() ||
            "Nothing read yet. The worker reads new files within a minute or so."}
        </pre>
      </details>
      {owner && (
        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap items-center gap-2 border-t bg-popover px-4 py-3">
          {review && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <CheckCircleIcon weight="fill" />
              Confirm
            </Button>
          )}
          <Button
            type="submit"
            variant={review ? "outline" : "default"}
            disabled={busy || !dirty}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="ml-auto"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await dismissDocs([id])
                if (r.error) return notice({ text: r.error, error: true })
                notice({
                  text: "Not a document now. It stays where it is.",
                  undo: () => void markDocs([id]).then(reload),
                })
                await reload()
              })
            }
          >
            <FileXIcon />
            Not a document
          </Button>
        </div>
      )}
    </form>
  )
}
