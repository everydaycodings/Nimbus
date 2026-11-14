import type { Item } from "@nimbus/shared/api"
import { router } from "expo-router"
import { CaretRight, CheckCircle, FileDashed, FileText, NotePencil } from "phosphor-react-native"
import { Pressable, View } from "react-native"

import { SheetRow, useDismiss } from "@/components/sheet"
import { Text } from "@/components/ui"
import { useDocActions, useDocSummary, useDocument } from "@/lib/documents"
import { c } from "@/lib/theme"

const mute = c.mutedForeground
const mineFiles = (items: Item[]) => items.length > 0 && items.every((i) => i.kind === "file" && !i.role && !i.shortcut)

// File menu rows for the Documents section: mark, confirm, edit details. Nothing when the admin turned Documents off.
export function DocumentRows({ items }: { items: Item[] }) {
  const summary = useDocSummary()
  const actions = useDocActions()
  const ok = !summary.off && mineFiles(items)
  const one = items.length === 1 ? items[0] : null
  const doc = useDocument(one?.id ?? "", ok && !!one)
  if (!ok) return null
  const ids = items.map((i) => i.id)
  const say = (p: Promise<string | void>) => void p
  if (!one)
    return <SheetRow label="Mark as documents" icon={<FileText size={24} color={mute} />} onPress={() => say(actions.mark(ids, true))} />
  const d = doc.data?.item
  if (!d || d.status === "dismissed")
    return doc.isPending ? null : <SheetRow label="Mark as document" icon={<FileText size={24} color={mute} />} onPress={() => say(actions.mark(ids, true))} />
  return (
    <>
      <SheetRow label="Document details" icon={<NotePencil size={24} color={mute} />} onPress={() => router.push({ pathname: "/documents/[id]", params: { id: d.id } })} />
      {d.status === "review" && (
        <SheetRow label="Confirm document" icon={<CheckCircle size={24} color={mute} />} onPress={() => say(actions.patch(d.id, { status: "confirmed" }, `Confirm ${d.name}`, undefined, "Confirmed."))} />
      )}
      <SheetRow label="Not a document" icon={<FileDashed size={24} color={mute} />} onPress={() => say(actions.mark(ids, false))} />
    </>
  )
}

// Details: what the document is, one tap from its editor. Shows only for files that are documents.
export function DocumentLink({ item }: { item: Item }) {
  const summary = useDocSummary()
  const dismiss = useDismiss()
  const ok = !summary.off && item.kind === "file" && !item.shortcut
  const q = useDocument(item.id, ok)
  const d = q.data?.item
  if (!ok || !d || d.status === "dismissed") return null
  const line = [d.typeName ?? "Document", d.senderName].filter(Boolean).join(" · ")
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Document, ${line}${d.status === "review" ? ", needs review" : ""}`}
      android_ripple={{ color: c.ripple }}
      onPress={() => dismiss(() => router.push({ pathname: "/documents/[id]", params: { id: d.id } }))}
      style={{ minHeight: 56, paddingHorizontal: 20, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" color={mute}>Document</Text>
        <Text>{line}</Text>
        {d.status === "review" && <Text variant="caption" color={c.warning}>Needs review</Text>}
      </View>
      <CaretRight size={16} color={mute} />
    </Pressable>
  )
}
