import type { PhotoPerson } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { Image } from "expo-image"
import { router } from "expo-router"
import { Plus, UserCircle, UsersThree } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, ScrollView, View } from "react-native"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { SwitchRow } from "@/components/page"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { coverSource, cropSource, photosText, useAi, usePeople, usePeopleRefresh } from "@/lib/people"
import { c } from "@/lib/theme"

// A round picture: the face, or a quiet person icon when there isn't one.
export function FaceImage({ source, size, label }: { source: { uri: string; headers: Record<string, string> } | null; size: number; label?: string }) {
  const box = { width: size, height: size, borderRadius: size / 2 }
  if (!source)
    return (
      <View style={[box, { backgroundColor: c.muted, alignItems: "center", justifyContent: "center" }]}>
        <UserCircle size={size * 0.6} color={c.dim} />
      </View>
    )
  return <Image source={source} style={[box, { backgroundColor: c.muted }]} contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors accessibilityLabel={label} />
}

export function PersonFace({ person, size }: { person: Pick<PhotoPerson, "id" | "coverFaceId">; size: number }) {
  const { account } = useApi()
  return <FaceImage source={person.coverFaceId ? coverSource(account, person.id, person.coverFaceId) : null} size={size} />
}

export function FaceCrop({ faceId, size }: { faceId: string; size: number }) {
  const { account } = useApi()
  return <FaceImage source={cropSource(account, faceId)} size={size} />
}

export const personName = (p: Pick<PhotoPerson, "name">) => p.name || "Unnamed"

// People on the Photos tab: faces of the people I have named, then See all.
export const PEOPLE_H = 112
export function PeopleRow({ people }: { people: PhotoPerson[] }) {
  return (
    <View style={{ height: PEOPLE_H, justifyContent: "center" }}>
      <Text variant="titleSmall" accessibilityRole="header" style={{ paddingHorizontal: 16, paddingBottom: 8 }}>People</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}>
        {people.slice(0, 12).map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${personName(p)}, ${photosText(p.photos)}`}
            android_ripple={{ color: c.ripple }}
            onPress={() => router.push({ pathname: "/people/[id]", params: { id: p.id, name: p.name ?? "" } })}
            style={{ width: 64, alignItems: "center", gap: 4 }}
          >
            <PersonFace person={p} size={56} />
            <Text variant="caption" color={p.name ? c.foreground : c.mutedForeground} numberOfLines={1}>{personName(p)}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all people"
          android_ripple={{ color: c.ripple }}
          onPress={() => router.push("/people")}
          style={{ width: 64, alignItems: "center", gap: 4 }}
        >
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: c.muted }}>
            <UsersThree size={26} color={c.mutedForeground} />
          </View>
          <Text variant="caption" color={c.mutedForeground}>See all</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

// Choose who a face or a set of photos belongs to, or make someone new.
export function PersonPickSheet({
  title,
  exclude,
  newLabel = "New person",
  onPick,
  onNew,
  onClose,
}: {
  title: string
  exclude?: string
  newLabel?: string
  onPick: (person: PhotoPerson) => void | Promise<unknown>
  // Leave out to list only existing people (merge).
  onNew?: (name: string) => Promise<string | void>
  onClose: () => void
}) {
  const people = usePeople(false)
  const [naming, setNaming] = useState(false)
  const list = people.data?.people.filter((p) => p.id !== exclude) ?? []
  return (
    <>
      <Sheet onClose={onClose} tall={list.length > 5} header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{title}</Text>}>
        {onNew && (
          <>
            <SheetRow label={newLabel} icon={<Plus size={24} color={c.brand} />} onPress={() => setNaming(true)} />
            <SheetDivider />
          </>
        )}
        {people.isPending ? (
          <View style={{ height: 96 }}><Spinner /></View>
        ) : people.isError ? (
          <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8, alignItems: "flex-start" }}>
            <Text color={c.destructive}>{people.error.message}</Text>
            <Button variant="outlined" label="Try again" busy={people.isFetching} onPress={() => people.refetch()} />
          </View>
        ) : list.length === 0 ? (
          <Text color={c.mutedForeground} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>No one else yet.</Text>
        ) : (
          list.map((p) => <SheetRow key={p.id} label={personName(p)} detail={photosText(p.photos)} icon={<PersonFace person={p} size={32} />} onPress={() => onPick(p)} />)
        )}
      </Sheet>
      {naming && onNew && (
        <PromptDialog
          title={newLabel}
          label="Name"
          confirm="Save"
          onClose={() => {
            setNaming(false)
            onClose()
          }}
          onSubmit={onNew}
        />
      )}
    </>
  )
}

// Face grouping on or off. Off deletes the faces and people the server found, so it asks first.
export function FaceGroupingRow({ icon }: { icon?: React.ReactNode }) {
  const api = useApi()
  const ai = useAi()
  const snack = useSnack()
  const refresh = usePeopleRefresh()
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  if (!ai.faces) return null
  const set = async (on: boolean) => {
    try {
      await api.put("/account/faces", { on })
      await refresh()
      await client.invalidateQueries({ queryKey: ["me", api.id] })
      snack({ text: on ? "Face grouping is on. New photos will be sorted by who is in them." : "Face grouping is off and its data is deleted." })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }
  return (
    <>
      <SwitchRow
        label="Face grouping"
        detail={ai.facesOn ? "Groups photos by who is in them" : "Off"}
        icon={icon}
        value={ai.facesOn}
        onChange={(on) => (on ? set(true) : setAsking(true))}
      />
      {asking && (
        <ConfirmDialog
          title="Turn off face grouping?"
          body="Nimbus deletes the faces and people it found in your photos, including the names you gave them. Turning it back on starts again from scratch."
          confirm="Turn off and delete"
          onClose={() => setAsking(false)}
          onConfirm={() => set(false)}
        />
      )}
    </>
  )
}
