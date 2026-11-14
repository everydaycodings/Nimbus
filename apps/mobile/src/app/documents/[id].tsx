import type { DocType, DocumentDetail } from "@nimbus/shared/documents-api"
import { router, useLocalSearchParams } from "expo-router"
import { ArrowLeft, CaretDown, CaretUp, CheckCircle, FileDashed, FileText, Plus, Warning, X } from "phosphor-react-native"
import { useState } from "react"
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { DateField, TONE } from "@/components/documents-ui"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, Field, IconButton, Spinner, Text } from "@/components/ui"
import { useDocActions, useDocSenders, useDocSummary, useDocTypes, useDocument } from "@/lib/documents"
import { dayText, expiryInfo, formFrom, money, patchFrom, toItem, type Form } from "@/lib/documents-rules"
import { openPreview } from "@/lib/preview-session"
import { c, radius } from "@/lib/theme"

// One document's facts: what Nimbus guessed, what you set, and Confirm.
export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useDocument(id)
  const actions = useDocActions()
  const summary = useDocSummary()
  const d = q.data?.item
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">Document details</Text>
          {d && <Text variant="caption" color={c.mutedForeground} numberOfLines={1} ellipsizeMode="middle">{d.name}</Text>}
        </View>
        {d && <IconButton icon={FileText} label="Open the file" onPress={() => openPreview({ items: [toItem(d)], index: 0, role: d.role })} />}
      </Bar>
      {d ? (
        <Editor key={d.id} d={d} />
      ) : q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <View style={{ padding: 24, gap: 12, alignItems: "flex-start" }}>
          <Text color={c.mutedForeground}>{q.error.message}</Text>
          <Button variant="outlined" label="Try again" busy={q.isFetching} onPress={() => q.refetch()} />
        </View>
      ) : (
        <View style={{ padding: 24, gap: 12, alignItems: "flex-start" }}>
          {summary.off ? <Text color={c.mutedForeground}>Documents is turned off.</Text> : <>
          <Text variant="titleSmall">This file isn&apos;t a document</Text>
          <Text color={c.mutedForeground}>Mark it as one to give it a type, sender, date and amount.</Text>
          <Button label="Mark as document" onPress={async () => { const e = await actions.mark([id], true); if (e) actions.say(Promise.resolve(e)); else void q.refetch() }} />
          </>}
        </View>
      )}
    </View>
  )
}

function Editor({ d }: { d: DocumentDetail }) {
  const inset = useSafeAreaInsets()
  const snack = useSnack()
  const actions = useDocActions()
  const types = useDocTypes()
  const senders = useDocSenders()
  const [form, setForm] = useState<Form>(() => formFrom(d))
  const [sheet, setSheet] = useState<"type" | "sender" | null>(null)
  const [text, setText] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const readOnly = d.role === "viewer"
  const type = types.data?.find((t) => t.id === form.typeId)
  const typeLine = type?.name ?? (form.typeId ? d.typeName : null)
  const exp = expiryInfo(d)
  const follow = type?.remindDays ?? d.remindDays

  const save = async (confirm: boolean) => {
    const r = patchFrom(form, d)
    if ("error" in r) return snack({ text: r.error, error: true })
    const patch = confirm ? { ...r.patch, status: "confirmed" as const } : r.patch
    if (!Object.keys(patch).length) return snack({ text: "Nothing changed." })
    setBusy(true)
    const err = await actions.patch(d.id, patch, `Edit ${d.name}`, type?.name, confirm ? "Confirmed." : "Saved.")
    setBusy(false)
    if (err) snack({ text: err, error: true })
    else if (confirm) router.back()
  }

  // Hints as on the web: "Guessed from the text" while the field is the guess, "Guessed X · Use" once changed.
  const g = d.guess
  const review = d.status === "review" && !readOnly
  const guessType = g.type ? types.data?.find((t) => t.key === g.type || t.name.toLowerCase() === g.type!.toLowerCase()) : undefined
  const clipType = !g.type && g.clip ? (types.data?.find((t) => t.key === g.clip!.type)?.name.toLowerCase() ?? g.clip.type) : null
  const known = (senders.data ?? []).some((s) => s.name.toLowerCase() === form.sender.trim().toLowerCase())
  const dateGuess = g.date ? dayText(g.date) : null
  const amountGuess = g.amount != null ? money(g.amount, g.currency ?? null) : null
  const expiryGuess = g.expiry ? dayText(g.expiry) : null
  const hint = (same: boolean, guess: string | null | undefined, use: () => void) =>
    review && guess ? <GuessHint same={same} guess={guess} use={use} /> : null

  const lock = readOnly ? { editable: false } : {}
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 640, padding: 16, paddingBottom: 24, gap: 20 }}>
        {readOnly && <Note text={`Shared by ${d.owner ?? "someone"}. Only the owner can change these details.`} />}
        {d.dupOf && (
          <Note
            tone="warn"
            text={`This looks like the same document as ${d.dupOf.name}.`}
            action="Open it"
            onAction={() => router.push({ pathname: "/documents/[id]", params: { id: d.dupOf!.id } })}
          />
        )}
        {exp && exp.tone !== "muted" && <Note tone={exp.tone === "danger" ? "danger" : "warn"} text={exp.text} />}
        {review && <Text variant="bodySmall" color={c.mutedForeground}>Nimbus filled this in by reading the file. Check it, then confirm.</Text>}

        <Pick label="Type" value={typeLine} placeholder="No type" disabled={readOnly} onPress={() => setSheet("type")} />
        {hint(form.typeId === guessType?.id, guessType?.name, () => set({ typeId: guessType!.id }))}
        {review && clipType && <Text variant="caption" color={c.mutedForeground} style={{ marginTop: -12 }}>Looks like {clipType} ({Math.round(g.clip!.score * 100)}% sure)</Text>}
        <Field label="Sender" value={form.sender} onChangeText={(sender) => set({ sender })} autoCapitalize="words" placeholder="Who it is from" {...lock} />
        {!readOnly && form.sender.trim() && !known && <Text variant="caption" color={c.mutedForeground} style={{ marginTop: -12 }}>New sender, added when you save</Text>}
        {hint(form.sender === g.sender, g.sender, () => set({ sender: g.sender! }))}
        {!readOnly && senders.data && senders.data.length > 0 && (
          <Pressable accessibilityRole="button" onPress={() => setSheet("sender")} style={{ marginTop: -12, minHeight: 36, justifyContent: "center", alignSelf: "flex-start" }}>
            <Text variant="bodySmall" color={c.brand}>Pick a known sender</Text>
          </Pressable>
        )}
        <ReadOnlyDate on={readOnly} label="Document date" value={form.docDate} onChange={(docDate) => set({ docDate })} />
        {hint(form.docDate === g.date, dateGuess, () => set({ docDate: g.date! }))}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 2 }}><Field label="Amount" value={form.amount} onChangeText={(amount) => set({ amount })} keyboardType="decimal-pad" placeholder="0.00" {...lock} /></View>
          <View style={{ flex: 1 }}><Field label="Currency" value={form.currency} onChangeText={(currency) => set({ currency })} autoCapitalize="characters" maxLength={3} placeholder="USD" {...lock} /></View>
        </View>
        {hint(String(g.amount) === form.amount, amountGuess, () => set({ amount: String(g.amount), currency: g.currency ?? form.currency }))}
        <ReadOnlyDate on={readOnly} label="Expires or due" value={form.expiresAt} onChange={(expiresAt) => set({ expiresAt })} />
        {hint(form.expiresAt === g.expiry, expiryGuess, () => set({ expiresAt: g.expiry! }))}
        <Field
          label="Remind me before (days)"
          value={form.remindDays}
          onChangeText={(remindDays) => set({ remindDays })}
          keyboardType="number-pad"
          placeholder={follow == null ? "Never" : String(follow)}
          hint={form.remindDays.trim() ? "Your own lead time." : follow == null ? "Follows the type: no reminder." : `Follows the type: ${follow} days.`}
          {...lock}
        />
        <Field label="Notes" value={form.notes} onChangeText={(notes) => set({ notes })} multiline style={{ minHeight: 88, textAlignVertical: "top" }} {...lock} />

        {(form.fields.length > 0 || !readOnly) && (
          <View style={{ gap: 12 }}>
            <Text variant="titleSmall" accessibilityRole="header">More details</Text>
            {form.fields.map((f, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Name" value={f.k} onChangeText={(k) => set({ fields: form.fields.map((x, j) => (j === i ? { ...x, k } : x)) })} {...lock} /></View>
                <View style={{ flex: 1 }}><Field label="Value" value={f.v} onChangeText={(v) => set({ fields: form.fields.map((x, j) => (j === i ? { ...x, v } : x)) })} {...lock} /></View>
                {!readOnly && <IconButton icon={X} label={`Remove ${f.k || "field"}`} onPress={() => set({ fields: form.fields.filter((_, j) => j !== i) })} />}
              </View>
            ))}
            {!readOnly && <Button variant="outlined" label="Add a detail" icon={<Plus size={18} color={c.foreground} />} onPress={() => set({ fields: [...form.fields, { k: "", v: "" }] })} />}
          </View>
        )}

        {d.text && (
          <View style={{ gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: text }} onPress={() => setText(!text)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text variant="titleSmall" style={{ flex: 1 }}>Text Nimbus read</Text>
              {text ? <CaretUp size={18} color={c.mutedForeground} /> : <CaretDown size={18} color={c.mutedForeground} />}
            </Pressable>
            {text && <Text variant="bodySmall" color={c.mutedForeground} selectable>{d.text}</Text>}
          </View>
        )}

        {!readOnly && (
          <Button
            variant="text"
            danger
            label="Not a document"
            icon={<FileDashed size={20} color={c.destructive} />}
            onPress={async () => {
              const err = await actions.mark([d.id], false)
              if (err) snack({ text: err, error: true })
              else router.back()
            }}
          />
        )}
      </ScrollView>

      {!readOnly && (
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", padding: 12, paddingBottom: inset.bottom + 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card }}>
          <Button variant="outlined" label="Save" busy={busy} onPress={() => save(false)} />
          {d.status !== "confirmed" && <Button label="Save and confirm" busy={busy} icon={<CheckCircle size={20} color={c.primaryForeground} />} onPress={() => save(true)} />}
        </View>
      )}

      {sheet === "type" && (
        <Sheet onClose={() => setSheet(null)}>
          <SheetRow label="No type" selected={!form.typeId} onPress={() => set({ typeId: null })} />
          {(types.data ?? []).map((t: DocType) => <SheetRow key={t.id} label={t.name} detail={t.remindDays == null ? undefined : `Reminds ${t.remindDays} days before`} selected={form.typeId === t.id} onPress={() => set({ typeId: t.id })} />)}
        </Sheet>
      )}
      {sheet === "sender" && (
        <Sheet onClose={() => setSheet(null)}>
          {(senders.data ?? []).map((s) => <SheetRow key={s.id} label={s.name} selected={form.sender.toLowerCase() === s.name.toLowerCase()} onPress={() => set({ sender: s.name })} />)}
        </Sheet>
      )}
    </KeyboardAvoidingView>
  )
}

function ReadOnlyDate({ on, label, value, onChange }: { on: boolean; label: string; value: string | null; onChange: (v: string | null) => void }) {
  if (!on) return <DateField label={label} value={value} onChange={onChange} />
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <Text color={value ? c.foreground : c.mutedForeground}>{value ? dayText(value) : "Not set"}</Text>
    </View>
  )
}

function Pick({ label, value, placeholder, disabled, onPress }: { label: string; value: string | null | undefined; placeholder: string; disabled?: boolean; onPress: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? placeholder}${disabled ? "" : ". Change"}`}
        disabled={disabled}
        android_ripple={{ color: c.ripple }}
        onPress={onPress}
        style={{ minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderRadius: radius.control, borderWidth: 1, borderColor: c.input }}
      >
        <Text color={value ? c.foreground : c.mutedForeground} style={{ flex: 1 }}>{value ?? placeholder}</Text>
        {!disabled && <CaretDown size={16} color={c.mutedForeground} />}
      </Pressable>
    </View>
  )
}

function Note({ text, tone = "muted", action, onAction }: { text: string; tone?: "muted" | "warn" | "danger"; action?: string; onAction?: () => void }) {
  const color = tone === "muted" ? c.mutedForeground : TONE[tone]
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.card, borderWidth: 1, borderColor: c.border }}>
      <Warning size={20} color={color} />
      <Text variant="bodySmall" style={{ flex: 1 }}>{text}</Text>
      {action && <Button variant="text" label={action} onPress={onAction!} />}
    </View>
  )
}

function GuessHint({ same, guess, use }: { same: boolean; guess: string; use: () => void }) {
  if (same) return <Text variant="caption" color={c.mutedForeground} style={{ marginTop: -12 }}>Guessed from the text</Text>
  return (
    <View style={{ marginTop: -12, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
      <Text variant="caption" color={c.mutedForeground}>Guessed {guess} · </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Use ${guess}`} onPress={use} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
        <Text variant="caption" style={{ textDecorationLine: "underline" }}>Use</Text>
      </Pressable>
    </View>
  )
}
