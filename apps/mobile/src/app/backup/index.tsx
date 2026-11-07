import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { formatBytes } from "@nimbus/shared/file-rules"
import { router } from "expo-router"
import { ArrowClockwise, CaretRight, CheckCircle, CloudArrowUp, Pause, Warning } from "phosphor-react-native"
import { useEffect, useState } from "react"
import { Linking, Pressable, View } from "react-native"

import { Actions, Frame } from "@/components/dialog"
import { Caret, Group, Page, Row, Section, SwitchRow } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, IconButton, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { errorText } from "@/lib/api"
import { askForMedia, useAlbums, useBackup } from "@/lib/backup"
import { describe } from "@/lib/backup-rules"
import { syncAvailable } from "@/lib/folder-sync"
import { native } from "@/lib/native"
import { c, radius } from "@/lib/theme"

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" })

export default function Backup() {
  const { accounts } = useAccounts()
  const { settings, status, change, refresh } = useBackup()
  const albums = useAlbums()
  const snack = useSnack()
  const [pickAccount, setPickAccount] = useState(false)
  const [freeUp, setFreeUp] = useState(false)
  const target = accounts.find((a) => a.id === settings.accountId)
  const line = describe(status)
  const Icon = status.state === "failing" ? Warning : status.state === "idle" ? CheckCircle : status.state === "paused" ? Pause : CloudArrowUp
  // Older APKs have no queue to show.
  const queue = settings.enabled && typeof native?.backupQueue === "function"
  const tint = status.state === "failing" ? c.destructive : status.state === "off" ? c.mutedForeground : c.brand
  const extras = albums?.filter((a) => settings.albums.includes(a.id)).map((a) => a.name) ?? []

  const turnOn = async (on: boolean) => {
    if (on && !(await askForMedia())) return snack({ text: "Nimbus needs access to your photos and videos to back them up.", error: true })
    change({ enabled: on, accountId: settings.accountId ?? accounts[0]?.id ?? null, from: settings.from || (on ? Date.now() : 0) })
  }

  const chooseFrom = () =>
    DateTimePickerAndroid.open({
      value: new Date(settings.from || Date.now()),
      maximumDate: new Date(),
      mode: "date",
      onChange: (e, date) => e.type === "set" && date && change({ from: new Date(date).setHours(0, 0, 0, 0) }),
    })

  return (
    <Page title="Camera backup">
      {/* State matters more than the settings, so it comes first. */}
      <Pressable
        accessibilityLiveRegion="polite"
        accessibilityRole={queue ? "button" : undefined}
        accessibilityHint={queue ? "Shows the queue, to pause or skip" : undefined}
        disabled={!queue}
        onPress={() => router.push("/backup/queue")}
        android_ripple={{ color: c.ripple }}
        style={{ flexDirection: "row", gap: 16, alignItems: "center", padding: 16, borderWidth: 1, borderColor: c.border, borderRadius: radius.card, backgroundColor: c.card, overflow: "hidden" }}
      >
        <View style={{ width: 40, height: 40, borderRadius: radius.control, backgroundColor: c.muted, alignItems: "center", justifyContent: "center" }}>
          <Icon size={22} color={tint} weight={status.state === "idle" ? "fill" : "regular"} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="titleSmall">{line.title}</Text>
          <Text variant="bodySmall" color={c.mutedForeground}>{line.detail}</Text>
        </View>
        {queue && <CaretRight size={20} color={c.mutedForeground} />}
      </Pressable>

      {status.access === "none" && settings.enabled && (
        <Section note="Photo access was turned off for Nimbus, so backup has stopped. Allow photos and videos to start it again.">
          <View style={{ alignItems: "flex-start" }}>
            {/* Asks again; after "Don't ask again" Android only allows it from Settings. */}
            <Button variant="outlined" label="Allow access" onPress={async () => ((await askForMedia()) ? refresh() : Linking.openSettings())} />
          </View>
        </Section>
      )}

      {status.access === "partial" && settings.enabled && (
        <Section note="You allowed Nimbus to see only some photos, so new ones won't back up until you allow all of them.">
          <View style={{ alignItems: "flex-start" }}>
            <Button variant="outlined" label="Allow all photos" onPress={() => Linking.openSettings()} />
          </View>
        </Section>
      )}

      <Group>
        <SwitchRow label="Back up photos and videos" detail="Into Camera in My files, by year and month" value={settings.enabled} onChange={turnOn} />
        {settings.enabled && (
          <Row
            label="Backing up to"
            detail={target ? `${target.email} · ${target.server.replace(/^https?:\/\//, "")}` : "Choose an account"}
            trailing={<Caret />}
            onPress={() => setPickAccount(true)}
          />
        )}
      </Group>

      {settings.enabled && (
        <>
          <Section title="What">
            <Group>
              <Row label="Items from" detail={settings.from ? `Taken on or after ${day(settings.from)}` : "Everything on this phone"} trailing={<Caret />} onPress={chooseFrom} />
              {!!settings.from && <Row label="Back up everything instead" onPress={() => change({ from: 0 })} />}
              <Row
                label="Other albums"
                detail={extras.length ? extras.join(", ") : "Only the camera"}
                trailing={<Caret />}
                onPress={() => router.push("/backup/albums")}
              />
            </Group>
          </Section>

          <Section title="When">
            <Group>
              <SwitchRow label="Use mobile data" detail="Otherwise backup waits for Wi-Fi" value={settings.mobileData} onChange={(v) => change({ mobileData: v })} />
              {settings.mobileData && <SwitchRow label="Videos on Wi-Fi only" value={settings.videosWifiOnly} onChange={(v) => change({ videosWifiOnly: v })} />}
              <SwitchRow label="Only while charging" value={settings.chargingOnly} onChange={(v) => change({ chargingOnly: v })} />
              <SwitchRow
                label="Reliable backup"
                detail="Shows a notification while backing up, so Android doesn't pause it. Uses more battery."
                value={settings.reliable}
                onChange={(v) => change({ reliable: v })}
              />
            </Group>
          </Section>
        </>
      )}

      {syncAvailable && (
        <Section title="Other folders">
          <Group>
            <Row label="Folder backup & sync" detail="Back up or sync any folder, including an SD card" trailing={<Caret />} onPress={() => router.push("/folder-sync")} />
          </Group>
        </Section>
      )}

      {status.failed.length > 0 && (
        <Section
          title={`Couldn't back up (${status.failed.length})`}
          trailing={<Button variant="text" label="Retry all" onPress={() => { native?.retryBackup(); setTimeout(refresh, 300) }} />}
        >
          <Group>
            {status.failed.slice(0, 50).map((f) => (
              <Row key={f.mediaId} label={f.name} detail={f.error} trailing={<IconButton icon={ArrowClockwise} label={`Retry ${f.name}`} onPress={() => { native?.retryBackup(); setTimeout(refresh, 300) }} />} />
            ))}
          </Group>
        </Section>
      )}

      {status.lastAt !== undefined && (
        <Section title="Free up space" note="Removes photos and videos from this phone once Nimbus has them. Android asks you to confirm.">
          <Group>
            <Row label="Free up space" trailing={<Caret />} onPress={() => setFreeUp(true)} />
          </Group>
        </Section>
      )}

      {pickAccount && (
        <Sheet onClose={() => setPickAccount(false)}>
          {accounts.map((a) => (
            <SheetRow key={a.id} selected={a.id === settings.accountId} label={a.name} detail={`${a.email} · ${a.server.replace(/^https?:\/\//, "")}`} onPress={() => change({ accountId: a.id })} />
          ))}
        </Sheet>
      )}
      {freeUp && <FreeUp onClose={() => setFreeUp(false)} onError={(e) => snack({ text: errorText(e), error: true })} onDone={(n) => snack({ text: n ? `Removed ${n} item${n === 1 ? "" : "s"} from this phone.` : "Nothing was removed." })} />}
    </Page>
  )
}

const AGES = [
  { days: 30, label: "Older than 30 days" },
  { days: 90, label: "Older than 90 days" },
  { days: 0, label: "Everything backed up" },
]

// Only items the server confirms it has are offered; Android shows its own confirmation after.
function FreeUp({ onClose, onDone, onError }: { onClose: () => void; onDone: (n: number) => void; onError: (e: unknown) => void }) {
  const [days, setDays] = useState(30)
  const [found, setFound] = useState<{ days: number; count: number; bytes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async (d: number) => {
    setDays(d)
    setFound(null)
    try {
      setFound({ days: d, ...JSON.parse(await native!.freeUpCandidates(d)) })
    } catch (e) {
      onError(e)
      onClose()
    }
  }
  useEffect(() => {
    check(30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Frame title="Free up space" onClose={onClose}>
      <View style={{ gap: 4 }}>
        {AGES.map((a) => (
          <Row key={a.days} label={a.label} trailing={days === a.days ? <CheckCircle size={20} color={c.brand} weight="fill" /> : undefined} onPress={() => check(a.days)} />
        ))}
      </View>
      <Text color={c.mutedForeground}>
        {found?.days !== days ? "Checking with the server…" : found.count ? `${found.count} item${found.count === 1 ? "" : "s"} · ${formatBytes(found.bytes)}` : "Nothing to remove for that choice."}
      </Text>
      <Actions>
        <Button variant="text" label="Cancel" onPress={onClose} />
        <Button
          label="Free up"
          busy={busy}
          disabled={found?.days !== days || !found.count}
          onPress={async () => {
            setBusy(true)
            try {
              onDone(await native!.freeUp(days))
            } catch (e) {
              onError(e)
            }
            onClose()
          }}
        />
      </Actions>
    </Frame>
  )
}
