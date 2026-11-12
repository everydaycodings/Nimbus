import type { Album } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { Plus, SquaresFour } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { PromptDialog } from "@/components/dialog"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useAlbums } from "@/lib/photos"
import { c } from "@/lib/theme"

// What a change to albums refreshes: the list, one album's page and its cover.
export function useAlbumRefresh() {
  const client = useQueryClient()
  const { id } = useApi()
  return () => client.invalidateQueries({ queryKey: [id, "albums"] })
}

const count = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`

// Add photos to one of my albums (or one I contribute to), or to a new one.
export function AlbumPickSheet({ nodeIds, onClose }: { nodeIds: string[]; onClose: () => void }) {
  const api = useApi()
  const albums = useAlbums()
  const snack = useSnack()
  const refresh = useAlbumRefresh()
  const [naming, setNaming] = useState(false)
  const open = (a: { id: string; name: string }) => router.push({ pathname: "/albums/[id]", params: { id: a.id, name: a.name } })
  const usable = (albums.data ?? []).filter((a) => a.role !== "viewer")

  const add = async (a: Album) => {
    try {
      const { added } = await api.post<{ added: number }>(`/albums/${a.id}/items`, { nodeIds })
      await refresh()
      snack({ text: added ? `Added ${count(added)} to “${a.name}”.` : `Already in “${a.name}”.` })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <>
      <Sheet onClose={onClose} header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>Add to album</Text>}>
        <SheetRow label="New album" icon={<Plus size={24} color={c.mutedForeground} />} stay onPress={() => setNaming(true)} />
        {usable.map((a) => (
          <SheetRow
            key={a.id}
            label={a.name}
            detail={a.role === "owner" ? count(a.count) : `${count(a.count)} · ${a.ownerName}`}
            icon={<SquaresFour size={24} color={c.mutedForeground} />}
            onPress={() => add(a)}
          />
        ))}
        {albums.isPending && <View style={{ height: 56 }} />}
      </Sheet>
      {naming && (
        <PromptDialog
          title="New album"
          label="Album name"
          confirm="Create"
          onClose={() => {
            setNaming(false)
            onClose()
          }}
          onSubmit={async (name) => {
            try {
              const { id } = await api.post<{ id: string }>("/albums", { name, nodeIds })
              await refresh()
              snack({ text: `Added ${count(nodeIds.length)} to “${name}”.` })
              open({ id, name })
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
    </>
  )
}
