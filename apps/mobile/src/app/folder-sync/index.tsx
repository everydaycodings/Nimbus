import type { SystemKind } from "@nimbus/shared/api"
import { ArrowsClockwise, CaretRight, CheckCircle, FolderSimple, Plus, Warning } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"

import { ConfirmDialog } from "@/components/dialog"
import { FileIcon } from "@/components/file-icon"
import { Caret, Group, Page, Row, Section, SwitchRow } from "@/components/page"
import { Sheet, SheetRow, useDismiss } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, IconButton, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { errorText } from "@/lib/api"
import { useFolders } from "@/lib/files"
import { systemLabel } from "@/lib/system-folders"
import { pickPhoneFolder, syncAvailable, useFolderSync } from "@/lib/folder-sync"
import { describePair, type SyncPair } from "@/lib/folder-sync-rules"
import { c } from "@/lib/theme"

export default function FolderSync() {
  const { active } = useAccounts()
  const fs = useFolderSync()
  const snack = useSnack()
  const [adding, setAdding] = useState<{ uri: string; name: string } | null>(null)
  const [open, setOpen] = useState<SyncPair | null>(null)
  const [removing, setRemoving] = useState<SyncPair | null>(null)
  const running = fs.pairs.some((p) => p.state === "running")

  const add = async () => {
    const dir = await pickPhoneFolder()
    if (dir) setAdding(dir)
  }

  if (!syncAvailable)
    return (
      <Page title="Folder backup & sync">
        <Text color={c.mutedForeground}>Folder sync needs the installed Nimbus app. It isn't in Expo Go.</Text>
      </Page>
    )

  return (
    <Page
      title="Folder backup & sync"
      trailing={fs.pairs.length > 0 ? <IconButton icon={ArrowsClockwise} label="Sync all now" onPress={() => fs.syncNow(null)} /> : undefined}
    >
      <Text variant="bodySmall" color={c.mutedForeground}>
        Pick a folder on this phone or an SD card and a folder in My files. Back up only sends new and changed files up. Two-way sync keeps both the same, and anything deleted goes to Trash.
      </Text>

      {fs.pairs.length === 0 ? (
        <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: c.input, borderRadius: 12, padding: 24, gap: 16, alignItems: "center" }}>
          <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>No folders yet.</Text>
          <Button label="Add a folder" icon={<Plus size={18} color={c.primaryForeground} />} onPress={add} />
        </View>
      ) : (
        <>
          <Group>
            {fs.pairs.map((p) => {
              const bad = p.state === "failing" || p.state === "held" || p.failed > 0
              const Icon = bad ? Warning : p.state === "idle" && p.lastAt ? CheckCircle : FolderSimple
              return (
                <Row
                  key={p.id}
                  label={p.name}
                  detail={`${p.twoWay ? "Two-way" : "Back up"} · ${p.folderName} → ${p.remotePath}\n${describePair(p)}`}
                  icon={<Icon size={24} color={bad ? c.destructive : p.paused ? c.mutedForeground : c.brand} weight={p.state === "idle" && !bad ? "fill" : "regular"} />}
                  trailing={p.state === "running" ? <ActivityIndicator color={c.brand} accessibilityLabel="Syncing" /> : <Caret />}
                  onPress={() => setOpen(p)}
                />
              )
            })}
          </Group>
          <View style={{ alignItems: "flex-start" }}>
            <Button variant="outlined" label="Add a folder" icon={<Plus size={18} color={c.foreground} />} onPress={add} />
          </View>
        </>
      )}

      {fs.failures.length > 0 && (
        <Section
          title={`Couldn't sync (${fs.failures.length})`}
          trailing={<Button variant="text" label="Retry all" onPress={() => fs.retry(null)} />}
        >
          <Group>
            {fs.failures.slice(0, 50).map((f) => (
              <Row key={`${f.pairId}/${f.path}`} label={f.path} detail={`${f.pairName} · ${f.error}`} />
            ))}
          </Group>
        </Section>
      )}

      <Section title="When" note="Folder sync checks every 15 minutes, when you open Nimbus, and when the server has news.">
        <Group>
          <SwitchRow label="Use mobile data" detail="Otherwise folder sync waits for Wi-Fi" value={fs.rules.mobileData} onChange={(v) => fs.setRules({ mobileData: v })} />
          <SwitchRow label="Only while charging" value={fs.rules.chargingOnly} onChange={(v) => fs.setRules({ chargingOnly: v })} />
          <SwitchRow
            label="Reliable sync"
            detail="Shows a notification while syncing, so Android doesn't pause it. Uses more battery."
            value={fs.rules.reliable}
            onChange={(v) => fs.setRules({ reliable: v })}
          />
        </Group>
      </Section>

      {adding && active && (
        <AddSheet
          folder={adding}
          accountLabel={active.email}
          onClose={() => setAdding(null)}
          onAdd={(remote, twoWay) => {
            try {
              fs.add({ accountId: active.id, name: adding.name, treeUri: adding.uri, folderName: adding.name, remoteId: remote.id, remotePath: remote.path, twoWay })
              snack({ text: "Folder added. Syncing now." })
              fs.refresh()
            } catch (e) {
              snack({ text: errorText(e), error: true })
            }
          }}
        />
      )}
      {open && (
        <Sheet onClose={() => setOpen(null)} header={<SheetHeader title={open.name} caption={describePair(open)} />}>
          {open.state === "held" && <SheetRow label="Go ahead with the deletions" detail={open.reason ?? undefined} onPress={() => fs.syncNow(open.id)} />}
          {!open.paused && <SheetRow label="Sync now" onPress={() => fs.syncNow(open.id)} />}
          {open.failed > 0 && <SheetRow label="Retry what failed" onPress={() => fs.retry(open.id)} />}
          <SheetRow label={open.paused ? "Resume" : "Pause"} onPress={() => fs.update(open, { paused: !open.paused })} />
          <SheetRow
            label={open.twoWay ? "Change to back up only" : "Change to two-way sync"}
            detail={open.twoWay ? "Stops saving server changes to the phone and stops deleting" : "Server changes come to the phone, and deletes follow both ways"}
            onPress={() => fs.update(open, { twoWay: !open.twoWay })}
          />
          <SheetRow label="Remove" danger onPress={() => setRemoving(open)} />
        </Sheet>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove “${removing.name}”?`}
          body="Nimbus stops syncing it. Files on the phone and in Nimbus stay where they are."
          confirm="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => fs.remove(removing.id)}
        />
      )}
      {running && <View accessibilityLiveRegion="polite" accessible accessibilityLabel="Syncing" style={{ height: 0 }} />}
    </Page>
  )
}

function SheetHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4, paddingHorizontal: 20, paddingBottom: 8, minHeight: 56, justifyContent: "center" }}>
      <Text variant="titleSmall" numberOfLines={1}>{title}</Text>
      {caption ? <Text variant="caption" color={c.mutedForeground} numberOfLines={2}>{caption}</Text> : null}
    </View>
  )
}

type Place = { id: string | null; name: string; system?: SystemKind }

function AddSheet({ folder, accountLabel, onClose, onAdd }: { folder: { name: string }; accountLabel: string; onClose: () => void; onAdd: (remote: { id: string | null; path: string }, twoWay: boolean) => void }) {
  const [stack, setStack] = useState<Place[]>([{ id: null, name: "My files" }])
  const [twoWay, setTwoWay] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const here = stack[stack.length - 1]
  const path = stack.map((s) => s.name).join(" / ")
  if (choosing) return <FolderChooser stack={stack} setStack={setStack} onClose={() => setChoosing(false)} />
  return (
    <Sheet onClose={onClose} header={<SheetHeader title="Add a folder" caption={accountLabel} />} footer={<AddFooter onAdd={() => onAdd({ id: here.id, path }, twoWay)} />}>
      <Row label="On this phone" detail={folder.name} icon={<FolderSimple size={24} color={c.mutedForeground} />} />
      <Row label="In Nimbus" detail={path} icon={<FolderSimple size={24} color={c.file.folder} weight="fill" />} trailing={<CaretRight size={16} color={c.mutedForeground} />} onPress={() => setChoosing(true)} />
      <SwitchRow label="Two-way sync" detail={twoWay ? "Changes on either side are copied across. Deletes go to Trash." : "Back up only: new and changed files go up, nothing comes down."} value={twoWay} onChange={setTwoWay} />
    </Sheet>
  )
}

function AddFooter({ onAdd }: { onAdd: () => void }) {
  const dismiss = useDismiss()
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
      <Button label="Add" onPress={() => dismiss(onAdd)} />
    </View>
  )
}

function FolderChooser({ stack, setStack, onClose }: { stack: Place[]; setStack: (s: Place[]) => void; onClose: () => void }) {
  const here = stack[stack.length - 1]
  const q = useFolders(here.id)
  return (
    <Sheet
      tall
      onClose={onClose}
      header={
        <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4 }}>
          <View style={{ flex: 1 }}><SheetHeader title={here.name} caption="Choose where it goes" /></View>
          {stack.length > 1 && <Button variant="text" label="Up" onPress={() => setStack(stack.slice(0, -1))} />}
        </View>
      }
      footer={
        <View style={{ paddingHorizontal: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
          <Button label="Use this folder" onPress={onClose} />
        </View>
      }
    >
      {q.isPending ? (
        <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ margin: 24 }} />
      ) : q.isError ? (
        <Text color={c.mutedForeground} style={{ padding: 20 }}>{q.error instanceof Error ? q.error.message : "Couldn't load folders."}</Text>
      ) : q.data.folders.length === 0 ? (
        <Text color={c.mutedForeground} style={{ padding: 20 }}>No folders here</Text>
      ) : (
        q.data.folders.map((f) => (
          <SheetRow key={f.id} stay label={f.name} detail={f.system ? systemLabel(f.system) : undefined} icon={<FileIcon item={{ kind: "folder", mime: null, name: f.name, system: f.system }} />} trailing={<CaretRight size={20} color={c.mutedForeground} />} onPress={() => setStack([...stack, f])} />
        ))
      )}
    </Sheet>
  )
}
