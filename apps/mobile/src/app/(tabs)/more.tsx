import { router, useFocusEffect } from "expo-router"
import { formatBytes } from "@nimbus/shared/file-rules"
import { ArrowCircleDown, ArrowSquareOut, Broom, CaretRight, CloudArrowUp, FolderOpen, GearSix, Lock, Tag, Trash, UploadSimple } from "phosphor-react-native"
import { useCallback, useState } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Group, Row } from "@/components/page"
import { StorageMeter } from "@/components/storage-meter"
import { Button, Text } from "@/components/ui"
import { useSnack } from "@/components/snackbar"
import { cacheSize, clearCache } from "@/lib/file-cache"
import { backupAvailable, useBackup } from "@/lib/backup"
import { describe } from "@/lib/backup-rules"
import { useApi, useMe } from "@/lib/files"
import { useOffline } from "@/lib/offline"
import { useQueue } from "@/lib/offline-queue"
import { usePrefs } from "@/lib/prefs"
import { vaultNative } from "@/lib/vault"
import { useTransfers } from "@/lib/transfers"
import { c, radius } from "@/lib/theme"

export default function More() {
  const inset = useSafeAreaInsets()
  const { account, id } = useApi()
  const me = useMe()
  const snack = useSnack()
  const [prefs] = usePrefs(id)
  const { chooseFolder } = useTransfers()
  const [cached, setCached] = useState(0)
  const backup = useBackup()
  const offline = useOffline(id)
  const queue = useQueue(id)
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
          <Group>
            {backupAvailable && <Row label="Camera backup" detail={backup.settings.enabled ? describe(backup.status).title : "Off"} icon={<CloudArrowUp size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/backup")} />}
            <Row label="Uploads" icon={<UploadSimple size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/uploads")} />
            <Row
              label="Offline"
              detail={queue.failed.length ? `${queue.failed.length} couldn't sync` : queue.waiting ? `${queue.waiting} waiting to sync` : undefined}
              icon={<ArrowCircleDown size={24} color={c.mutedForeground} />}
              trailing={
                <Text variant="bodySmall" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>
                  {offline.count ? formatBytes(offline.bytes) : "Off"}
                </Text>
              }
              onPress={() => router.push("/offline")}
            />
            <Row label="Trash" icon={<Trash size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/trash")} />
            <Row label="Tags" icon={<Tag size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/tags")} />
            <Row label="Vaults" detail={vaultNative ? "Encrypted on this phone" : "Needs the installed app"} icon={<Lock size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/vault")} />
            <Row label="Account settings" icon={<GearSix size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/account")} />
          </Group>
          <Group>
            <Row
              label={prefs.downloadDir ? "Change download folder" : "Choose download folder"}
              icon={<FolderOpen size={24} color={c.mutedForeground} />}
              trailing={caret}
              onPress={() => chooseFolder()}
            />
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
          </Group>
          {/* Only admins are told it exists; members never see this row. */}
          {me.data?.canAdmin && (
            <Group>
              <Row
                label="Open admin on web"
                trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />}
                onPress={() => Linking.openURL(`${account.server}/admin`)}
              />
            </Group>
          )}
    </ScrollView>
  )
}
