import type { FileFace, Item, PersonResult } from "@nimbus/shared/api"
import { Tag } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, ScrollView, View } from "react-native"

import { FaceCrop, PersonPickSheet } from "@/components/people-ui"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useFileFaces, usePeopleRefresh } from "@/lib/people"
import { c } from "@/lib/theme"

// "Add to person…": tap the face that is them, or tag the whole photo when none of the faces fits.
export function AddToPersonSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const refresh = usePeopleRefresh()
  const faces = useFileFaces(item.id, true)
  const [face, setFace] = useState<FileFace | "photo" | null>(null)
  const found = (faces.data ?? []).filter((f) => f.box)

  const done = async (name: string | null) => {
    await refresh()
    snack({ text: `Added to ${name ?? "that person"}.` })
  }
  // The server's 400 (already tagged, invalid) comes back as the message.
  const guard = async (task: () => Promise<string | null>) => {
    try {
      await done(await task())
    } catch (e) {
      snack({ text: errorText(e), error: true })
      return errorText(e)
    }
  }
  const body = (target: FileFace | "photo", extra: { personId: string } | { name: string }) =>
    target === "photo"
      ? api.post<PersonResult>(`/files/${item.id}/faces`, extra).then((r) => r.person.name)
      : api.post(`/faces/${target.id}/assign`, extra).then(() => ("name" in extra ? extra.name : null))

  // A hand tag skips the faces step when nothing was detected.
  const target = face ?? (faces.isSuccess && !found.length ? "photo" : null)
  if (target)
    return (
      <PersonPickSheet
        title={target === "photo" ? "Tag this photo with" : "Who is this?"}
        onClose={onClose}
        onPick={(p) => guard(() => body(target, { personId: p.id }).then((n) => n ?? p.name))}
        onNew={(name) => guard(() => body(target, { name }).then((n) => n ?? name))}
      />
    )

  return (
    <Sheet onClose={onClose} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Add to person</Text>}>
      {faces.isPending ? (
        <View style={{ height: 96 }}><Spinner /></View>
      ) : faces.isError ? (
        <Text color={c.destructive} style={{ paddingHorizontal: 20, paddingVertical: 12 }}>{faces.error.message}</Text>
      ) : (
        <>
          <Text variant="caption" color={c.mutedForeground} style={{ paddingHorizontal: 20, paddingBottom: 4 }}>Tap the face that is them</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {found.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => setFace(f)}
                android_ripple={{ color: c.ripple, borderless: true }}
                accessibilityRole="button"
                accessibilityLabel={f.personName ? `Face of ${f.personName}. Change` : "Unnamed face. Choose who"}
                style={{ minHeight: 48, alignItems: "center", gap: 4, paddingVertical: 4 }}
              >
                <FaceCrop faceId={f.id} size={64} />
                <Text variant="caption" color={f.personName ? c.foreground : c.mutedForeground} numberOfLines={1} style={{ maxWidth: 64 }}>{f.personName ?? "Who?"}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <SheetDivider />
          <SheetRow stay label="None of these – tag the photo" icon={<Tag size={24} color={c.mutedForeground} />} onPress={() => setFace("photo")} />
        </>
      )}
    </Sheet>
  )
}

