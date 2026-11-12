import { router, useFocusEffect } from "expo-router"
import { formatBytes } from "@nimbus/shared/file-rules"
import { ArrowCircleDown, ArrowSquareOut, Broom, CaretRight, ClockCounterClockwise, CloudArrowUp, Fingerprint, FolderOpen, FolderSimple as FolderSync, GearSix, Info, Lock, PaperPlaneTilt, Tag, Trash, UploadSimple } from "phosphor-react-native"
import * as LocalAuthentication from "expo-local-authentication"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { lockSetting, setLock } from "@/components/lock"
import { Group, Row, SwitchRow } from "@/components/page"
import { getMobileQuality, setMobileQuality } from "@/lib/playback"
import { ChoiceRow } from "@/components/playback-settings"
import { StorageMeter } from "@/components/storage-meter"
import { Button, Text } from "@/components/ui"
import { useSnack } from "@/components/snackbar"
import { cacheSize, clearCache } from "@/lib/file-cache"
import { backupAvailable, useBackup } from "@/lib/backup"
import { syncAvailable } from "@/lib/folder-sync"
import { describe } from "@/lib/backup-rules"
import { readPhone } from "@/lib/phone-backup"
import { useApi, useMe } from "@/lib/files"
import { useOffline } from "@/lib/offline"
import { useQueue } from "@/lib/offline-queue"
import { usePrefs } from "@/lib/prefs"
import { useSent } from "@/lib/sent"
import { homeHref } from "@/lib/tab"
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
  // Photos, then contacts and calendar: the screen holds both.
  const phone = readPhone()
  const backupDetail = backup.settings.enabled ? describe(backup.status).title : phone.contacts || phone.calendar ? "Contacts and calendar" : "Off"
  const offline = useOffline(id)
  const queue = useQueue(id)
  const sent = useSent()
  useFocusEffect(useCallback(() => setCached(cacheSize(id)), [id]))
  const [locked, setLocked] = useState(false)
  useEffect(() => void lockSetting().then((s) => setLocked(s === "on")), [])
  const flipLock = async (on: boolean) => {
    // With no screen lock on the phone there'd be nothing to unlock with.
    if (on && (await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE)
      return snack({ text: "Set a screen lock, fingerprint or face on this phone first.", error: true })
    setLocked(on)
    await setLock(on)
  }
  const caret = <CaretRight size={16} color={c.mutedForeground} />

  return (
    <View style={{ flex: 1 }}>
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
            {backupAvailable && <Row label="Backup" detail={backupDetail} icon={<CloudArrowUp size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/backup")} />}
            {syncAvailable && <Row label="Folder backup & sync" icon={<FolderSync size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/folder-sync")} />}
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
            {sent.data?.options.enabled !== false && <Row label="Transfers" detail="Send files by email or link" icon={<PaperPlaneTilt size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/transfers")} />}
            <Row label="Recent" icon={<ClockCounterClockwise size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.navigate(homeHref("(recent)"))} />
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
            <ChoiceRow
              label="Video on mobile data"
              detail="Wi-Fi always plays the original. Needs data-saver copies from your server."
              options={[{ value: 480, label: "480p" }, { value: 720, label: "720p" }, { value: "original", label: "Original" }]}
              get={getMobileQuality}
              set={setMobileQuality}
            />
            <SwitchRow icon={<Fingerprint size={24} color={c.mutedForeground} />} label="App lock" detail="Ask for your fingerprint, face or screen lock when Nimbus opens" value={locked} onChange={flipLock} />
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
          <Group>
            <Row label="About" icon={<Info size={24} color={c.mutedForeground} />} trailing={caret} onPress={() => router.push("/about")} />
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
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: inset.top, backgroundColor: c.background }} />
    </View>
  )
}
