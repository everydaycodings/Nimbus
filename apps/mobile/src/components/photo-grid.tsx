import type { PhotoItem } from "@nimbus/shared/api"
import { typeKeyOf } from "@nimbus/shared/file-rules"
import { Image } from "expo-image"
import { CheckCircle, Play, UsersThree } from "phosphor-react-native"
import { memo, useMemo, useState, type ReactElement } from "react"
import { FlatList, Pressable, View, type LayoutChangeEvent } from "react-native"

import { FileIcon } from "@/components/file-icon"
import { useApi } from "@/lib/files"
import { thumbSource } from "@/lib/photos"
import { c } from "@/lib/theme"

export const GAP = 2

type Account = { server: string; token: string }

// One photo or video; a partner's carries a small badge, a chosen one a check.
export const PhotoTile = memo(function PhotoTile({
  photo,
  size,
  account,
  onPress,
  onLongPress,
  selected,
}: {
  photo: PhotoItem
  size: number
  account: Account
  onPress: () => void
  onLongPress?: () => void
  selected?: boolean
}) {
  const source = useMemo(() => (photo.thumb ? thumbSource(account, photo) : null), [account, photo])
  const video = typeKeyOf("file", photo.mime, photo.name) === "video"
  const when = new Date(photo.takenAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: c.ripple }}
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityLabel={`${video ? "Video" : "Photo"}, ${photo.name}, ${when}${photo.fromPartner && photo.owner ? `, from ${photo.owner}` : ""}`}
      style={{ width: size, height: size, backgroundColor: c.card, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
    >
      {source ? (
        <Image source={source} style={{ width: size, height: size }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={photo.id} accessibilityIgnoresInvertColors />
      ) : (
        <FileIcon item={photo} size={size > 90 ? 32 : 20} />
      )}
      {video && (
        <View style={{ position: "absolute", right: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
          <Play size={11} weight="fill" color="#fff" />
        </View>
      )}
      {photo.fromPartner && (
        <View style={{ position: "absolute", left: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
          <UsersThree size={12} weight="fill" color="#fff" />
        </View>
      )}
      {selected !== undefined && (
        <View style={{ position: "absolute", inset: 0, backgroundColor: selected ? "rgba(95,208,187,0.28)" : "transparent" }}>
          <View style={{ position: "absolute", left: 6, top: 6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: selected ? "transparent" : "rgba(0,0,0,0.45)", borderWidth: selected ? 0 : 1.5, borderColor: "#fff" }}>
            {selected && <CheckCircle size={26} weight="fill" color={c.brand} />}
          </View>
        </View>
      )}
    </Pressable>
  )
})

// A plain grid of photos, 3 across (6 on a tablet), for the lists that aren't the whole timeline.
export function PhotoGrid({
  items,
  onOpen,
  onLongPress,
  selected,
  header,
  empty,
  onEnd,
}: {
  items: PhotoItem[]
  onOpen: (index: number) => void
  onLongPress?: (item: PhotoItem) => void
  selected?: Set<string>
  header?: ReactElement
  empty?: ReactElement
  onEnd?: () => void
}) {
  const { account } = useApi()
  const [w, setW] = useState(0)
  const perRow = w >= 560 ? 6 : 3
  const size = Math.floor((w - GAP * (perRow - 1)) / perRow)
  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <FlatList
          key={perRow}
          data={items}
          numColumns={perRow}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          extraData={selected}
          onEndReached={onEnd}
          initialNumToRender={18}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item, index }) => (
            <PhotoTile
              photo={item}
              size={size}
              account={account}
              selected={selected ? selected.has(item.id) : undefined}
              onPress={() => onOpen(index)}
              onLongPress={onLongPress ? () => onLongPress(item) : undefined}
            />
          )}
        />
      )}
    </View>
  )
}
