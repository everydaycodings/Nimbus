import type { Item } from "@nimbus/shared/api"
import { router, useLocalSearchParams } from "expo-router"
import { X } from "phosphor-react-native"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { CollaboraView } from "@/components/preview-pages"
import { IconButton, Spinner, Text } from "@/components/ui"
import { useDetails } from "@/lib/files"

// "Open in Collabora" from the ⋯ menu, for files the phone also has its own viewer for.
export default function Collabora() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const inset = useSafeAreaInsets()
  const details = useDetails(id)
  const item: Item | null | undefined = details.data?.item
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: inset.top, minHeight: inset.top + 56, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <IconButton icon={X} label="Close" onPress={() => router.back()} />
        <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1 }}>
          {item?.name ?? ""}
        </Text>
      </View>
      {item ? <CollaboraView item={item} top={0} active /> : <Spinner />}
    </View>
  )
}
