import type { FileFace, Item } from "@nimbus/shared/api"
import { router } from "expo-router"
import { ArrowSquareOut, Check, UserMinus, UsersThree, X } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, ScrollView, View } from "react-native"

import { PromptDialog } from "@/components/dialog"
import { FaceCrop, PersonPickSheet } from "@/components/people-ui"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useAi, useFileFaces, usePeopleRefresh } from "@/lib/people"
import { c } from "@/lib/theme"

// Details' "People": the faces found in one of my photos. Tap one to name it, pick a person or fix it.
export function PeopleFound({ item }: { item: Item }) {
  const ai = useAi()
  const q = useFileFaces(item.id, ai.faces && ai.facesOn)
  const [face, setFace] = useState<FileFace | null>(null)
  const faces = q.data
  if (!ai.faces || !ai.facesOn || !faces?.length) return null
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
      <Text variant="caption" color={c.mutedForeground}>People</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -8 }} contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}>
        {faces.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFace(f)}
            android_ripple={{ color: c.ripple, borderless: true }}
            accessibilityRole="button"
            accessibilityLabel={f.personName ? `${f.personName}. Change` : f.suggestion?.name ? `Maybe ${f.suggestion.name}. Answer` : "Unnamed face. Name it"}
            style={{ width: 72, minHeight: 48, alignItems: "center", gap: 4, paddingVertical: 4 }}
          >
            <FaceCrop faceId={f.id} size={56} />
            <Text variant="caption" color={f.personName ? c.foreground : c.brand} numberOfLines={1}>
              {f.personName ?? (f.suggestion?.name ? `Is it ${f.suggestion.name}?` : "Who?")}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {face && <FaceSheet key={face.id} item={item} face={face} onClose={() => setFace(null)} />}
    </View>
  )
}

function FaceSheet({ item, face, onClose }: { item: Item; face: FileFace; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const refresh = usePeopleRefresh()
  const [step, setStep] = useState<"menu" | "name" | "pick">("menu")
  const guess = face.suggestion
  const ic = (I: typeof Check, color: string = c.mutedForeground) => <I size={24} color={color} />

  const run = async (task: () => Promise<unknown>, done: string) => {
    try {
      await task()
      await refresh()
      snack({ text: done })
      return undefined
    } catch (e) {
      snack({ text: errorText(e), error: true })
      return errorText(e)
    }
  }

  if (step === "name")
    return (
      <PromptDialog
        title={face.personName ? "Rename" : "Name this person"}
        label="Name"
        initial={face.personName ?? ""}
        confirm="Save"
        onClose={onClose}
        onSubmit={async (name) => {
          try {
            await (face.personId ? api.patch(`/people/${face.personId}`, { name }) : api.post(`/faces/${face.id}/assign`, { name }))
            await refresh()
          } catch (e) {
            return errorText(e)
          }
        }}
      />
    )
  if (step === "pick")
    return (
      <PersonPickSheet
        title="Who is this?"
        exclude={face.personId ?? undefined}
        onClose={onClose}
        onPick={(p) => run(() => api.post(`/faces/${face.id}/assign`, { personId: p.id }), `Added to ${p.name ?? "that person"}.`)}
        onNew={async (name) => {
          try {
            await api.post(`/faces/${face.id}/assign`, { name })
            await refresh()
          } catch (e) {
            return errorText(e)
          }
        }}
      />
    )

  return (
    <Sheet
      onClose={onClose}
      header={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 8 }}>
          <FaceCrop faceId={face.id} size={48} />
          <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1 }}>{face.personName ?? "Who is this?"}</Text>
        </View>
      }
    >
      {guess && (
        <>
          <SheetRow label={`Yes, it's ${guess.name ?? "them"}`} icon={ic(Check, c.brand)} onPress={() => run(() => api.post(`/faces/${face.id}/suggestion`, { accept: true }), `Added to ${guess.name ?? "that person"}.`)} />
          <SheetRow label={`No, it's not ${guess.name ?? "them"}`} icon={ic(X)} onPress={() => run(() => api.post(`/faces/${face.id}/suggestion`, { accept: false }), "Thanks. It won't ask again.")} />
          <SheetDivider />
        </>
      )}
      <SheetRow label={face.personName ? "Rename" : "Name this person"} icon={ic(UsersThree)} onPress={() => setStep("name")} />
      <SheetRow label="Choose another person" icon={ic(UsersThree)} onPress={() => setStep("pick")} />
      {face.personId && (
        <>
          <SheetRow label={`Open ${face.personName ?? "their photos"}`} icon={ic(ArrowSquareOut)} onPress={() => router.push({ pathname: "/people/[id]", params: { id: face.personId!, name: face.personName ?? "" } })} />
          <SheetDivider />
          <SheetRow
            label={`Not ${face.personName ?? "this person"}`}
            icon={ic(UserMinus)}
            onPress={() => run(() => api.post(`/people/${face.personId}/not`, { faceIds: [face.id] }), "Taken off this person.")}
          />
        </>
      )}
    </Sheet>
  )
}
