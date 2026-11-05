import type { CopyVersionResponse, DeleteOlderResponse, Item, Version } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { useLocalSearchParams } from "expo-router"
import { ArrowCounterClockwise, CopySimple, DotsThreeVertical, DownloadSimple, Eye, NotePencil, PushPin, PushPinSlash, Trash } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, View } from "react-native"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { Group, Loaded, Page } from "@/components/page"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useDetails, useFileActions, useVersions } from "@/lib/files"
import { openPreview } from "@/lib/preview-session"
import { c } from "@/lib/theme"
import { useTransfers } from "@/lib/transfers"

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

type Ask = { kind: "menu" | "note" | "delete"; v: Version } | { kind: "older"; count: number }

export default function Versions() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const details = useDetails(id)
  const versions = useVersions(id)
  const actions = useFileActions()
  const transfers = useTransfers()
  const snack = useSnack()
  const [ask, setAsk] = useState<Ask | null>(null)
  const close = () => setAsk(null)
  const item = details.data?.item ?? null
  const title = item?.name ?? name

  const run = async (task: () => Promise<unknown>, text: string, undo?: () => void) => {
    try {
      await task()
      actions.refresh()
      snack({ text, undo })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }
  const makeCurrent = (v: Version, from?: Version) =>
    run(() => api.post(`/versions/${v.id}/current`), `v${v.number} is now current.`, from && (() => makeCurrent(from)))

  const preview = (file: Item, v: Version) =>
    openPreview({ items: [file], index: 0, role: file.role ?? "owner", version: v.current ? undefined : v })

  return (
    <Page title="Versions" caption={title}>
      <Loaded query={versions}>
        {(list) => {
          const current = list.find((v) => v.current)
          const newest = list[0]
          const older = list.filter((v) => !v.current)
          const deletable = older.filter((v) => !v.keep)
          if (!list.length) return <Text color={mute}>You can see versions of files you own or can edit.</Text>
          return (
            <View style={{ gap: 16 }}>
              <Text variant="bodySmall" color={mute}>
                {plural(list.length, "version")}
                {older.length ? `. Older versions use ${formatBytes(older.reduce((n, v) => n + v.size, 0))}.` : "."}
              </Text>
              {current && newest && current !== newest && (
                <Group>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 4, paddingVertical: 4 }}>
                    <Text variant="bodySmall" color={mute} style={{ flex: 1 }}>You&apos;re using v{current.number}. v{newest.number} is the newest.</Text>
                    <Button variant="text" label="Use newest" onPress={() => makeCurrent(newest, current)} />
                  </View>
                </Group>
              )}
              <Group>
                {list.map((v) => (
                  <View key={v.id} style={{ flexDirection: "row", alignItems: "center" }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open v${v.number} from ${when(v.createdAt)}${v.current ? ", current" : ""}${v.keep ? ", kept forever" : ""}`}
                      android_ripple={{ color: c.ripple }}
                      disabled={!item}
                      onPress={() => item && preview(item, v)}
                      style={{ flex: 1, minHeight: 64, paddingLeft: 16, paddingVertical: 8, gap: 2, justifyContent: "center" }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                        <Text variant="label">v{v.number}</Text>
                        {v.current && (
                          <View style={{ paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderColor: c.input }}>
                            <Text variant="caption">Current</Text>
                          </View>
                        )}
                        {v.keep && <PushPin size={14} weight="fill" color={mute} />}
                      </View>
                      <Text variant="caption" color={mute} style={{ fontVariant: ["tabular-nums"] }}>
                        {[when(v.createdAt), formatBytes(v.size), v.uploadedBy].filter(Boolean).join(" · ")}
                      </Text>
                      {v.note && <Text variant="bodySmall">{v.note}</Text>}
                    </Pressable>
                    <IconButton icon={DotsThreeVertical} label={`More for v${v.number}`} color={mute} onPress={() => setAsk({ kind: "menu", v })} />
                  </View>
                ))}
              </Group>
              {deletable.length > 0 && (
                <View style={{ alignSelf: "flex-start" }}>
                  <Button variant="outlined" danger label="Delete older versions" onPress={() => setAsk({ kind: "older", count: deletable.length })} />
                </View>
              )}
            </View>
          )
        }}
      </Loaded>

      {ask?.kind === "menu" && (
        <Sheet
          onClose={close}
          header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>v{ask.v.number} · {when(ask.v.createdAt)}</Text>}
        >
          {!ask.v.current && (
            <SheetRow
              label="Make current"
              icon={<ArrowCounterClockwise size={24} color={mute} />}
              onPress={() => makeCurrent(ask.v, versions.data?.find((v) => v.current))}
            />
          )}
          {item && <SheetRow label="Open" icon={<Eye size={24} color={mute} />} onPress={() => preview(item, ask.v)} />}
          {item && <SheetRow label="Download" icon={<DownloadSimple size={24} color={mute} />} onPress={() => transfers.download([item], ask.v)} />}
          <SheetRow
            label="Save as separate file"
            icon={<CopySimple size={24} color={mute} />}
            onPress={async () => {
              try {
                const { name: saved } = await api.post<CopyVersionResponse>(`/versions/${ask.v.id}/copy`)
                actions.refresh()
                snack({ text: `Saved as “${saved}”.` })
              } catch (e) {
                snack({ text: errorText(e), error: true })
              }
            }}
          />
          <SheetRow label={ask.v.note ? "Edit note" : "Add note"} icon={<NotePencil size={24} color={mute} />} onPress={() => setAsk({ kind: "note", v: ask.v })} />
          <SheetRow
            label={ask.v.keep ? "Don't keep" : "Keep forever"}
            icon={ask.v.keep ? <PushPinSlash size={24} color={mute} /> : <PushPin size={24} color={mute} />}
            onPress={() =>
              run(
                () => api.patch(`/versions/${ask.v.id}`, { keep: !ask.v.keep }),
                ask.v.keep ? `v${ask.v.number} is no longer kept forever.` : `v${ask.v.number} will be kept forever.`
              )
            }
          />
          {!ask.v.current && (
            <>
              <SheetDivider />
              <SheetRow label="Delete version" danger icon={<Trash size={24} color={c.destructive} />} onPress={() => setAsk({ kind: "delete", v: ask.v })} />
            </>
          )}
        </Sheet>
      )}
      {ask?.kind === "note" && (
        <PromptDialog
          title={`Note for v${ask.v.number}`}
          label="Note"
          initial={ask.v.note ?? ""}
          confirm="Save"
          canSubmit={() => true}
          onClose={close}
          onSubmit={async (note) => {
            try {
              await api.patch(`/versions/${ask.v.id}`, { note })
              actions.refresh()
              snack({ text: note ? `Saved the note on v${ask.v.number}.` : `Removed the note on v${ask.v.number}.` })
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
      {ask?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete v${ask.v.number}?`}
          body="This version is deleted for good. You can't undo this."
          confirm="Delete version"
          onClose={close}
          onConfirm={() => run(() => api.del(`/versions/${ask.v.id}`), `Deleted v${ask.v.number}.`)}
        />
      )}
      {ask?.kind === "older" && (
        <ConfirmDialog
          title="Delete older versions?"
          body={`${plural(ask.count, "version")} will be deleted for good. Versions kept forever stay.`}
          confirm="Delete versions"
          onClose={close}
          onConfirm={() => run(() => api.del<DeleteOlderResponse>(`/items/${id}/versions`), `Deleted the older versions of “${title ?? "this file"}”.`)}
        />
      )}
    </Page>
  )
}

const mute = c.mutedForeground
