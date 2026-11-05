import { router, useFocusEffect } from "expo-router"
import { formatBytes } from "@nimbus/shared/file-rules"
import { ArrowSquareOut, Broom, CaretRight, FolderOpen, Tag, Trash } from "phosphor-react-native"
import { useCallback, useState, type ReactNode } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { StorageMeter } from "@/components/storage-meter"
import { Button, Text } from "@/components/ui"
import { useSnack } from "@/components/snackbar"
import { cacheSize, clearCache } from "@/lib/file-cache"
import { useApi, useMe } from "@/lib/files"
import { usePrefs } from "@/lib/prefs"
import { useTransfers } from "@/lib/transfers"
import { c, radius } from "@/lib/theme"

function Row({ label, icon, trailing, onPress }: { label: string; icon?: ReactNode; trailing: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      android_ripple={{ color: c.ripple }}
      onPress={onPress}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingVertical: 8 }}
    >
      {icon}
      <Text style={{ flex: 1 }}>{label}</Text>
      {trailing}
    </Pressable>
  )
}

const Hairline = () => <View style={{ height: 1, backgroundColor: c.border }} />

export default function More() {
  const inset = useSafeAreaInsets()
  const { account, id } = useApi()
  const me = useMe()
  const snack = useSnack()
  const [prefs] = usePrefs(id)
  const { chooseFolder } = useTransfers()
  const [cached, setCached] = useState(0)
  useFocusEffect(useCallback(() => setCached(cacheSize(id)), [id]))
  const caret = <CaretRight size={16} color={c.mutedForeground} />

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{ paddingTop: inset.top + 16, paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}
    >
      <Text variant="title" accessibilityRole="header">More</Text>
      {/* Only the meter needs the account data; Trash and Tags always show. */}
      {me.isPending ? (
        <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ height: 96 }} />
      ) : !me.data ? (
        <View style={{ gap: 8, alignItems: "flex-start" }}>
          <Text variant="bodySmall" color={c.mutedForeground}>{me.error?.message}</Text>
          <Button variant="outlined" label="Try again" busy={me.isFetching} onPress={() => me.refetch()} />
        </View>
      ) : (
        me.data.usage && (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Shows what is using your storage"
              android_ripple={{ color: c.ripple }}
              onPress={() => router.push("/storage")}
              style={{ padding: 16, borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: "hidden" }}
            >
              <StorageMeter usage={me.data.usage} />
            </Pressable>
        )
      )}
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: "hidden" }}>
            <Row label="Trash" icon={<Trash size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/trash")} />
            <Hairline />
            <Row label="Tags" icon={<Tag size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/tags")} />
          </View>
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: "hidden" }}>
            <Row
              label={prefs.downloadDir ? "Change download folder" : "Choose download folder"}
              icon={<FolderOpen size={24} color={c.mutedForeground} />}
              trailing={caret}
              onPress={() => chooseFolder()}
            />
            <Hairline />
            <Row
              label="Clear cache"
              icon={<Broom size={24} color={c.mutedForeground} />}
              trailing={
                <Text variant="bodySmall" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>
                  {formatBytes(cached)}
                </Text>
              }
              onPress={() => {
                clearCache(id)
                setCached(0)
                snack({ text: "Cleared recently opened files from this phone." })
              }}
            />
          </View>
          {/* Only admins are told it exists; members never see this row. */}
          {me.data?.canAdmin && (
            <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: "hidden" }}>
              <Row
                label="Open admin on web"
                trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />}
                onPress={() => Linking.openURL(`${account.server}/admin`)}
              />
            </View>
          )}
    </ScrollView>
  )
}
