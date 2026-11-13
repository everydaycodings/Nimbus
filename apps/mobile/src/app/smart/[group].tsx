import type { SmartGroup } from "@nimbus/shared/api"
import { SMART_GROUPS } from "@nimbus/shared/smart-groups"
import { router, useLocalSearchParams } from "expo-router"
import { ArrowLeft } from "phosphor-react-native"
import { View } from "react-native"

import { SMART_LABEL } from "@/components/photo-chips"
import { usePhotoSheet } from "@/components/photo-sheets"
import { PhotoGrid } from "@/components/photo-grid"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { useSmart } from "@/lib/photos"
import { openPreview } from "@/lib/preview-session"
import { c } from "@/lib/theme"

const HELP: Record<SmartGroup, string> = {
  screenshots: "Screenshots are found by their name, folder and size.",
  documents: "Scans and document photos are found by their folder, name and the text in them.",
  receipts: "Receipts and invoices are found by the words and amounts in them.",
  videos: "Every video in your photos.",
}

// A smart group's photos: the same grid as Photos, filtered by what the worker found.
export default function Smart() {
  const { group } = useLocalSearchParams<{ group: SmartGroup }>()
  const known = (SMART_GROUPS as readonly string[]).includes(group)
  const list = useSmart(known ? group : "screenshots")
  const label = known ? SMART_LABEL[group] : "Photos"
  const sheets = usePhotoSheet()
  const { items, hasNextPage, fetchNextPage } = list

  const open = (index: number) =>
    openPreview({
      items,
      index,
      role: "owner",
      more: async () => {
        if (!hasNextPage) return null
        const next = await fetchNextPage()
        return next.data?.pages.flatMap((p) => p.items) ?? null
      },
    })

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">{label}</Text>
          {list.total > 0 && <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{list.total.toLocaleString()} {list.total === 1 ? "item" : "items"}</Text>}
        </View>
      </Bar>
      {!known ? (
        <Text color={c.mutedForeground} style={{ padding: 16 }}>That group doesn&apos;t exist.</Text>
      ) : list.isPending ? (
        <Spinner />
      ) : list.isError && !items.length ? (
        <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{(list.error as Error).message}</Text>
          <Button variant="outlined" label="Try again" busy={list.isFetching} onPress={() => list.refetch()} />
        </View>
      ) : (
        <PhotoGrid
          items={items}
          onOpen={open}
          onLongPress={sheets.show}
          empty={
            <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 8 }}>
              <Text variant="titleSmall" style={{ textAlign: "center" }}>Nothing here yet</Text>
              <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{HELP[group]} New photos are sorted in the background, so give it a few minutes.</Text>
            </View>
          }
        />
      )}
      {sheets.element}
    </View>
  )
}
