import type { Album } from "@nimbus/shared/api"
import { Image } from "expo-image"
import { router } from "expo-router"
import { ArrowLeft, Plus, SquaresFour, UsersThree } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAlbumRefresh } from "@/components/album-sheets"
import { PromptDialog } from "@/components/dialog"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { thumbSource, useAlbums } from "@/lib/photos"
import { c, radius } from "@/lib/theme"

const GAP = 12

function Card({ album, size }: { album: Album; size: number }) {
  const { account } = useApi()
  const detail = `${album.count} ${album.count === 1 ? "photo" : "photos"}${album.role === "owner" ? "" : ` · ${album.ownerName}`}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.name}, ${detail}${album.shared && album.role === "owner" ? ", shared" : ""}`}
      android_ripple={{ color: c.ripple }}
      onPress={() => router.push({ pathname: "/albums/[id]", params: { id: album.id, name: album.name } })}
      style={{ width: size, gap: 6 }}
    >
      <View style={{ width: size, height: size, borderRadius: radius.card, overflow: "hidden", backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
        {album.cover?.thumb ? (
          <Image source={thumbSource(account, album.cover)} style={{ width: size, height: size }} contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        ) : (
          <SquaresFour size={32} color={c.dim} />
        )}
        {album.shared && (
          <View style={{ position: "absolute", right: 8, bottom: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
            <UsersThree size={14} weight="fill" color="#fff" />
          </View>
        )}
      </View>
      <View style={{ paddingHorizontal: 2 }}>
        <Text variant="titleSmall" numberOfLines={1}>{album.name}</Text>
        <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{detail}</Text>
      </View>
    </Pressable>
  )
}

function Cards({ albums, size }: { albums: Album[]; size: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
      {albums.map((a) => <Card key={a.id} album={a} size={size} />)}
    </View>
  )
}

export default function Albums() {
  const api = useApi()
  const albums = useAlbums()
  const refresh = useAlbumRefresh()
  const inset = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [naming, setNaming] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const inner = Math.min(width, 640) - 32
  const perRow = inner >= 480 ? 3 : 2
  const size = Math.floor((inner - GAP * (perRow - 1)) / perRow)
  const mine = albums.data?.filter((a) => a.role === "owner") ?? []
  const shared = albums.data?.filter((a) => a.role !== "owner") ?? []

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>Albums</Text>
        <IconButton icon={Plus} label="New album" onPress={() => setNaming(true)} />
      </Bar>
      {albums.isPending ? (
        <Spinner />
      ) : albums.isError && !albums.data ? (
        <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{albums.error.message}</Text>
          <Button variant="outlined" label="Try again" busy={albums.isFetching} onPress={() => albums.refetch()} />
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                await albums.refetch().catch(() => {})
                setRefreshing(false)
              }}
              colors={[c.foreground]}
              progressBackgroundColor={c.muted}
            />
          }
          contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 640, padding: 16, paddingBottom: inset.bottom + 24, gap: 24 }}
        >
          {!albums.data?.length && (
            <View style={{ alignItems: "center", paddingVertical: 48, gap: 12 }}>
              <Text variant="titleSmall" style={{ textAlign: "center" }}>No albums yet</Text>
              <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
                An album gathers photos without moving them. Share it with people or with a link.
              </Text>
              <Button label="New album" icon={<Plus size={18} color={c.primaryForeground} />} onPress={() => setNaming(true)} />
            </View>
          )}
          {mine.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text variant="titleSmall" accessibilityRole="header">Your albums</Text>
              <Cards albums={mine} size={size} />
            </View>
          )}
          {shared.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text variant="titleSmall" accessibilityRole="header">Shared with you</Text>
              <Cards albums={shared} size={size} />
            </View>
          )}
        </ScrollView>
      )}
      {naming && (
        <PromptDialog
          title="New album"
          label="Album name"
          confirm="Create"
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            try {
              const { id } = await api.post<{ id: string }>("/albums", { name })
              await refresh()
              router.push({ pathname: "/albums/[id]", params: { id, name } })
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
    </View>
  )
}
