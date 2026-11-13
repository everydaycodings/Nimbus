import type { AlbumPhoto } from "@nimbus/shared/api"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { ArrowLeft, DotsThreeVertical, Image as ImageIcon, MinusCircle, PencilSimple, PlusCircle, ShareNetwork, Slideshow, Trash, X } from "phosphor-react-native"
import { useCallback, useState } from "react"
import { BackHandler, View } from "react-native"

import { useAlbumRefresh } from "@/components/album-sheets"
import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { usePhotoSheet } from "@/components/photo-sheets"
import { PhotoGrid } from "@/components/photo-grid"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useAlbum } from "@/lib/photos"
import { openPreview } from "@/lib/preview-session"
import { c } from "@/lib/theme"

// An album's photos. The owner can do everything, a contributor adds their own, a viewer looks.
export default function AlbumScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const query = useAlbum(id)
  const snack = useSnack()
  const refresh = useAlbumRefresh()
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const data = query.data
  const album = data?.album
  const items: AlbumPhoto[] = data?.items ?? []
  const owner = album?.role === "owner"
  const selecting = chosen.size > 0
  const picked = items.filter((p) => chosen.has(p.id))
  const sheets = usePhotoSheet()
  const clear = useCallback(() => setChosen(new Set()), [])

  // Back clears a selection before it leaves.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (!chosen.size) return false
        clear()
        return true
      })
      return () => sub.remove()
    }, [chosen.size, clear])
  )

  const toggle = (p: { id: string }) =>
    setChosen((s) => {
      const next = new Set(s)
      if (!next.delete(p.id)) next.add(p.id)
      return next
    })

  // A partner's or friend's photo can be saved from the previewer, so it's marked like a partner photo there.
  const open = (index: number) =>
    openPreview({
      items: items.map((p) => (p.owner ? { ...p, fromPartner: true } : p)),
      index,
      role: owner ? "owner" : "viewer",
    })

  const run = async (task: () => Promise<unknown>, done?: string) => {
    try {
      await task()
      await refresh()
      if (done) snack({ text: done })
      return true
    } catch (e) {
      snack({ text: errorText(e), error: true })
      return false
    }
  }

  if (query.isPending) return <View style={{ flex: 1, backgroundColor: c.background }}><Bar><IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} /></Bar><Spinner /></View>
  if (!data || !album)
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>{name ?? "Album"}</Text>
        </Bar>
        <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
            {(query.error as { status?: number } | null)?.status === 404 ? "This album is gone, or it isn't shared with you any more." : query.error?.message}
          </Text>
          <Button variant="outlined" label="Try again" busy={query.isFetching} onPress={() => query.refetch()} />
        </View>
      </View>
    )

  const removable = picked.filter((p) => p.canRemove)
  const caption = `${album.count} ${album.count === 1 ? "photo" : "photos"}${owner ? "" : ` · ${album.ownerName}`}`

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {selecting ? (
        <Bar>
          <IconButton icon={X} label="Clear selection" onPress={clear} />
          <Text variant="title" style={{ flex: 1, fontVariant: ["tabular-nums"] }}>{chosen.size} selected</Text>
          {chosen.size === 1 && <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => sheets.show(picked[0].owner ? { ...picked[0], fromPartner: true } : picked[0])} />}
          {owner && chosen.size === 1 && (
            <IconButton
              icon={ImageIcon}
              label="Make cover"
              onPress={async () => {
                if (await run(() => api.patch(`/albums/${id}`, { coverNodeId: picked[0].id }), "Changed the cover.")) clear()
              }}
            />
          )}
          <IconButton
            icon={MinusCircle}
            label="Remove from album"
            color={removable.length ? c.foreground : c.dim}
            onPress={async () => {
              if (!removable.length) return snack({ text: "You can only remove photos you added.", error: true })
              if (await run(() => api.del(`/albums/${id}/items`, { nodeIds: removable.map((p) => p.id) }), `Removed ${removable.length} from the album.`)) clear()
            }}
          />
        </Bar>
      ) : (
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header">{album.name}</Text>
            <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{caption}</Text>
          </View>
          {album.role !== "viewer" && <IconButton icon={PlusCircle} label="Add photos" onPress={() => router.push({ pathname: "/albums/add", params: { id } })} />}
          {items.length > 0 && <IconButton icon={Slideshow} label="Slideshow" onPress={() => router.push({ pathname: "/slideshow", params: { album: id, name: album.name } })} />}
          {owner && <IconButton icon={ShareNetwork} label="Share album" onPress={() => router.push({ pathname: "/albums/share/[id]", params: { id, name: album.name } })} />}
          {owner && <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => setMenu(true)} />}
        </Bar>
      )}

      <PhotoGrid
        items={items}
        selected={selecting ? chosen : undefined}
        onOpen={(i) => (selecting ? toggle(items[i]) : open(i))}
        onLongPress={toggle}
        empty={
          <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 12 }}>
            <Text variant="titleSmall" style={{ textAlign: "center" }}>No photos in this album</Text>
            {album.role !== "viewer" && (
              <Button label="Add photos" icon={<PlusCircle size={18} color={c.primaryForeground} />} onPress={() => router.push({ pathname: "/albums/add", params: { id } })} />
            )}
          </View>
        }
      />

      {sheets.element}
      {menu && (
        <Sheet onClose={() => setMenu(false)} header={<Text variant="titleSmall" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{album.name}</Text>}>
          <SheetRow label="Rename" icon={<PencilSimple size={24} color={c.mutedForeground} />} onPress={() => setDialog("rename")} />
          <SheetDivider />
          <SheetRow label="Delete album" danger icon={<Trash size={24} color={c.destructive} />} onPress={() => setDialog("delete")} />
        </Sheet>
      )}
      {dialog === "rename" && (
        <PromptDialog
          title="Rename album"
          label="Album name"
          confirm="Rename"
          initial={album.name}
          onClose={() => setDialog(null)}
          onSubmit={async (next) => {
            try {
              await api.patch(`/albums/${id}`, { name: next })
              await refresh()
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete “${album.name}”?`}
          body="The photos stay where they are. People it was shared with lose access, and its links stop working."
          confirm="Delete album"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (await run(() => api.del(`/albums/${id}`), `Deleted “${album.name}”.`)) router.back()
          }}
        />
      )}
    </View>
  )
}
