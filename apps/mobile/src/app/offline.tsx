import type { Item } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { ArrowsClockwise, DotsThreeVertical, X } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { ConfirmDialog } from "@/components/dialog"
import { FileIcon } from "@/components/file-icon"
import { Group, Page, Row, Section, SwitchRow } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, IconButton, Text } from "@/components/ui"
import { useOnline } from "@/lib/connectivity"
import { useApi } from "@/lib/files"
import { backgroundRefreshAvailable } from "@/lib/offline-task"
import { getCap, getCellular, lastRefresh, refreshAll, removeAll, setCap, setCellular, takeNotices, unmark, useOffline, useRefreshStatus } from "@/lib/offline"
import { discardFailed, replay, retryFailed, useQueue } from "@/lib/offline-queue"
import { CAPS, capLabel } from "@/lib/offline-rules"
import { c, radius } from "@/lib/theme"

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

function ago(ms: number | null) {
  if (!ms) return "not yet"
  const m = Math.round((Date.now() - ms) / 60_000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${plural(h, "hour")} ago` : new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" })
}

export default function Offline() {
  const { id } = useApi()
  const snack = useSnack()
  const online = useOnline()
  const snap = useOffline(id)
  const queue = useQueue(id)
  const status = useRefreshStatus()
  const [picker, setPicker] = useState(false)
  const [confirm, setConfirm] = useState(false)
  // Bumped so the switch and limit re-read their saved values.
  const [, redraw] = useState(0)
  const cap = getCap()
  const used = cap ? Math.min(1, snap.bytes / cap) : 0

  const refreshNow = async () => {
    if (!online) return snack({ text: "Refreshing needs a connection." })
    const ran = await refreshAll({ manual: true })
    const told = takeNotices()
    if (told.length) return snack({ text: told.length > 1 ? `${told[0]} And ${told.length - 1} more.` : told[0] })
    snack({ text: ran ? "Offline files are up to date." : "A refresh is already running." })
  }

  const retry = async (failedId: number) => {
    retryFailed(id, failedId)
    if (online) await replay([id])
  }

  return (
    <Page
      title="Offline"
      caption={online ? undefined : "No connection"}
      trailing={<IconButton icon={ArrowsClockwise} label="Refresh now" onPress={refreshNow} />}
    >
      <View style={{ gap: 12, padding: 16, borderWidth: 1, borderColor: c.border, borderRadius: radius.card }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text variant="titleSmall" style={{ fontVariant: ["tabular-nums"] }}>
            {formatBytes(snap.bytes)} <Text color={c.mutedForeground}>of {capLabel(cap)}</Text>
          </Text>
          <Text variant="caption" color={c.mutedForeground}>{plural(snap.count, "file")}</Text>
        </View>
        {cap !== null && (
          <View importantForAccessibility="no" style={{ height: 4, borderRadius: 2, backgroundColor: c.mutedStrong, overflow: "hidden" }}>
            <View style={{ height: 4, width: `${Math.max(used * 100, snap.bytes ? 2 : 0)}%`, backgroundColor: used >= 1 ? c.warning : c.brand }} />
          </View>
        )}
        <Text variant="caption" color={c.mutedForeground} accessibilityLiveRegion="polite">
          {status.running ? (status.text ? `Downloading “${status.text}”` : "Checking for changes") : `Last checked ${ago(lastRefresh(id))}`}
        </Text>
        <Button label="Refresh now" variant="outlined" busy={status.running} onPress={refreshNow} />
      </View>

      {(queue.waiting > 0 || queue.failed.length > 0) && (
        <Section
          title="Changes"
          note={queue.waiting ? `${plural(queue.waiting, "change")} will sync when you're online.` : undefined}
        >
          {queue.failed.length > 0 && (
            <Group>
              {queue.failed.map((f) => (
                <View key={f.id} style={{ padding: 16, gap: 8 }}>
                  <Text variant="label">{f.label}</Text>
                  <Text variant="caption" color={c.destructive}>{f.error || "The server couldn't make this change."} The server's version was kept.</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginLeft: -12 }}>
                    <Button variant="text" label="Retry" onPress={() => retry(f.id)} />
                    <Button variant="text" danger label="Discard" onPress={() => discardFailed(id, f.id)} />
                  </View>
                </View>
              ))}
            </Group>
          )}
        </Section>
      )}

      <Section title="Available offline">
        {snap.roots.length === 0 ? (
          <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: c.input, borderRadius: radius.card, padding: 24 }}>
            <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
              Nothing yet. Open <DotsThreeVertical size={14} color={c.mutedForeground} /> on a file or folder and choose Make available offline.
            </Text>
          </View>
        ) : (
          <Group>
            {snap.roots.map((item) => (
              <Kept key={item.id} item={item} onRemove={() => { unmark(id, [item.id]); snack({ text: `“${item.name}” removed from offline.` }) }} />
            ))}
          </Group>
        )}
      </Section>

      <Section title="Settings">
        <Group>
          <Row label="Storage limit" detail="Saving past it asks first. Nothing is removed on its own." trailing={<Text color={c.mutedForeground}>{capLabel(cap)}</Text>} onPress={() => setPicker(true)} />
          <SwitchRow
            label="Refresh on mobile data"
            detail={backgroundRefreshAvailable() ? "Nimbus checks for changes when you open it and every few hours. By default that waits for Wi-Fi." : "Nimbus checks for changes when you open it. By default that waits for Wi-Fi."}
            value={getCellular()}
            onChange={(on) => {
              setCellular(on)
              redraw((n) => n + 1)
            }}
          />
        </Group>
        {snap.roots.length > 0 && (
          <Group>
            <Row label="Remove all offline files" danger onPress={() => setConfirm(true)} />
          </Group>
        )}
      </Section>

      {picker && (
        <Sheet onClose={() => setPicker(false)} header={<View style={{ paddingHorizontal: 20, paddingBottom: 8 }}><Text variant="titleSmall">Storage limit</Text></View>}>
          {CAPS.map((option) => (
            <SheetRow
              key={String(option)}
              label={capLabel(option)}
              selected={option === cap}
              trailing={option === cap ? <Text color={c.brand}>Current</Text> : undefined}
              onPress={() => {
                setCap(option)
                redraw((n) => n + 1)
              }}
            />
          ))}
        </Sheet>
      )}
      {confirm && (
        <ConfirmDialog
          title="Remove all offline files?"
          body={`${formatBytes(snap.bytes)} is deleted from this phone. Your files stay on the server.`}
          confirm="Remove all"
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            removeAll(id)
            snack({ text: "Removed every offline file from this phone." })
          }}
        />
      )}
    </Page>
  )
}

function Kept({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const { id } = useApi()
  const snap = useOffline(id)
  const files = [...snap.rootOf].filter(([fid, root]) => root === item.id && snap.files.has(fid)).length
  const detail = item.kind === "folder" ? plural(files, "file") : item.size ? formatBytes(item.size) : undefined
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 4, minHeight: 56 }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 8 }}>
        <FileIcon item={item} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1}>{item.name}</Text>
          {detail && <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{detail}</Text>}
        </View>
      </View>
      <IconButton icon={X} label={`Remove ${item.name} from offline`} onPress={onRemove} />
    </View>
  )
}
