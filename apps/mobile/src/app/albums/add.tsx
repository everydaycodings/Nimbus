import { router, useLocalSearchParams } from "expo-router"
import { X } from "phosphor-react-native"
import { useMemo, useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAlbumRefresh } from "@/components/album-sheets"
import { PhotoGrid } from "@/components/photo-grid"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useAlbum, usePhotos } from "@/lib/photos"
import { c } from "@/lib/theme"

// Pick photos from your library for an album. The ones already in it are left out.
export default function AddToAlbum() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const api = useApi()
  const album = useAlbum(id)
  const photos = usePhotos()
  const snack = useSnack()
  const refresh = useAlbumRefresh()
  const inset = useSafeAreaInsets()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const have = useMemo(() => new Set(album.data?.items.map((p) => p.id)), [album.data])
  // Only your own photos can go in; a partner's stay theirs.
  const items = useMemo(() => photos.items.filter((p) => !p.fromPartner && !have.has(p.id)), [photos.items, have])

  const add = async () => {
    setBusy(true)
    try {
      await api.post(`/albums/${id}/items`, { nodeIds: [...chosen] })
      await refresh()
      snack({ text: `Added ${chosen.size} to “${album.data?.album.name ?? "the album"}”.` })
      router.back()
    } catch (e) {
      snack({ text: errorText(e), error: true })
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={X} label="Close" onPress={() => router.back()} />
        <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>{chosen.size ? `${chosen.size} selected` : "Add photos"}</Text>
      </Bar>
      {photos.isPending || album.isPending ? (
        <Spinner />
      ) : (
        <PhotoGrid
          items={items}
          selected={chosen}
          onOpen={(i) =>
            setChosen((s) => {
              const next = new Set(s)
              if (!next.delete(items[i].id)) next.add(items[i].id)
              return next
            })
          }
          empty={<Text color={c.mutedForeground} style={{ padding: 24, textAlign: "center" }}>Every photo you have is already in this album.</Text>}
        />
      )}
      {chosen.size > 0 && (
        <View style={{ padding: 16, paddingBottom: inset.bottom + 16, backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.border }}>
          <Button label={`Add ${chosen.size} ${chosen.size === 1 ? "photo" : "photos"}`} busy={busy} onPress={add} />
        </View>
      )}
    </View>
  )
}
