import { router } from "expo-router"
import { ArrowLeft, CaretRight, Trash } from "phosphor-react-native"
import { Fragment, useState, type ReactNode } from "react"
import { Pressable, RefreshControl, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ConfirmDialog } from "@/components/dialog"
import { FileIcon } from "@/components/file-icon"
import { StorageMeter } from "@/components/storage-meter"
import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { useFileActions, useStorage } from "@/lib/files"
import { c, radius } from "@/lib/theme"
import type { Item } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import type { ReportRow } from "@nimbus/shared/api"

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
const where = (f: ReportRow) => f.where || "My files"

// The actions only read id, name and kind off an item, as the web's report does.
const asItem = (f: ReportRow) => ({ id: f.id, name: f.name, kind: f.kind }) as Item

function Section({ title, note, actions, children }: { title: string; note?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="titleSmall" accessibilityRole="header">{title}</Text>
        {note && <Text variant="bodySmall" color={c.mutedForeground}>{note}</Text>}
      </View>
      {actions && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{actions}</View>}
      {children}
    </View>
  )
}

const List = ({ children }: { children: ReactNode }) => (
  <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: "hidden" }}>{children}</View>
)

const Empty = ({ children }: { children: string }) => (
  <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: c.input, borderRadius: radius.card, padding: 24 }}>
    <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{children}</Text>
  </View>
)

// Icon, name and detail, size, then any trailing control. `share` draws a thin
// bar of its part of the folder.
function Row({ row: f, detail, share, onPress, children }: { row: ReportRow; detail?: string; share?: number; onPress?: () => void; children?: ReactNode }) {
  const body = (
    <>
      <FileIcon item={f} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1}>{f.name}</Text>
        {detail && <Text variant="caption" color={c.mutedForeground} numberOfLines={2}>{detail}</Text>}
        {share !== undefined && (
          <View style={{ height: 2, borderRadius: 1, backgroundColor: c.muted, overflow: "hidden" }}>
            <View style={{ height: 2, width: `${Math.max(1, share * 100)}%`, backgroundColor: c.mutedForeground }} />
          </View>
        )}
      </View>
      <Text variant="bodySmall" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{formatBytes(f.size)}</Text>
    </>
  )
  const box = { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 } as const
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: children ? 4 : 16 }}>
      {onPress ? (
        <Pressable accessibilityRole="button" android_ripple={{ color: c.ripple }} onPress={onPress} style={[box, { flex: 1 }]}>
          {body}
        </Pressable>
      ) : (
        <View style={[box, { flex: 1 }]}>{body}</View>
      )}
      {children}
    </View>
  )
}

const Hairlines = ({ rows }: { rows: ReactNode[] }) => (
  <List>
    {rows.map((r, i) => (
      <Fragment key={i}>
        {i > 0 && <View style={{ height: 1, backgroundColor: c.border }} />}
        {r}
      </Fragment>
    ))}
  </List>
)

type Ask = { kind: "older"; row: ReportRow } | { kind: "empty"; count: number }

export default function Storage() {
  const inset = useSafeAreaInsets()
  const [folder, setFolder] = useState<string | null>(null)
  const report = useStorage(folder)
  const actions = useFileActions()
  const [ask, setAsk] = useState<Ask | null>(null)
  const r = report.data

  // Opens the folder a file is in, in the Files tab.
  const open = (f: ReportRow) =>
    router.push(f.parentId ? `/(tabs)/(files)/folder/${f.parentId}` : "/(tabs)/(files)/home")

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" accessibilityRole="header">Storage</Text>
      </Bar>

      {!r && report.isPending ? (
        <Spinner />
      ) : !r ? (
        <View style={{ padding: 24, gap: 12, alignItems: "flex-start" }}>
          <Text color={c.mutedForeground}>{report.error?.message}</Text>
          <Button variant="outlined" label="Try again" busy={report.isFetching} onPress={() => report.refetch()} />
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={report.isRefetching} onRefresh={async () => { await report.refetch() }} colors={[c.foreground]} progressBackgroundColor={c.muted} />}
          contentContainerStyle={{ padding: 16, paddingBottom: inset.bottom + 24, gap: 32 }}
        >
          <StorageMeter usage={r.usage} sizes bare />

          <Section title="Largest files" note="The 50 biggest files outside the trash and vaults.">
            {r.largest.length === 0 ? (
              <Empty>No files yet.</Empty>
            ) : (
              <Hairlines
                rows={r.largest.map((f) => (
                  <Row key={f.id} row={f} detail={where(f)} onPress={() => open(f)}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${f.name} to trash`}
                      android_ripple={{ color: c.ripple, radius: 24 }}
                      onPress={() => actions.trash([asItem(f)])}
                      style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
                    >
                      <Trash size={24} color={c.destructive} />
                    </Pressable>
                  </Row>
                ))}
              />
            )}
          </Section>

          <Section
            title="Old versions"
            note="Earlier versions kept beside the current one. Versions kept forever stay when you delete the rest."
          >
            {r.old.length === 0 ? (
              <Empty>No file has older versions.</Empty>
            ) : (
              <Hairlines
                rows={r.old.map((f) => {
                  const deletable = (f.versions ?? 0) - (f.keep ?? 0)
                  return (
                    <Row
                      key={f.id}
                      row={f}
                      detail={`${plural(f.versions ?? 0, "older version")}${f.keep ? `, ${f.keep} kept forever` : ""} · ${where(f)}`}
                      onPress={() => router.push({ pathname: "/versions/[id]", params: { id: f.id, name: f.name } })}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete older versions of ${f.name}`}
                        accessibilityState={{ disabled: deletable === 0 }}
                        disabled={deletable === 0}
                        android_ripple={{ color: c.ripple }}
                        onPress={() => setAsk({ kind: "older", row: f })}
                        style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: "center", opacity: deletable === 0 ? 0.4 : 1 }}
                      >
                        <Text variant="label" color={c.destructive}>Delete older</Text>
                      </Pressable>
                    </Row>
                  )
                })}
              />
            )}
          </Section>

          <Section
            title="Trash"
            note={r.trash.count ? `${plural(r.trash.count, "item")} · ${formatBytes(r.trash.bytes)}` : undefined}
            actions={
              r.trash.count > 0 && (
                <>
                  <Button variant="outlined" label="Open trash" onPress={() => router.push("/trash")} />
                  <Button variant="outlined" danger label="Empty trash" onPress={() => setAsk({ kind: "empty", count: r.trash.count })} />
                </>
              )
            }
          >
            {r.trash.count === 0 ? <Empty>The trash is empty.</Empty> : <Hairlines rows={r.trash.top.map((f) => <Row key={f.id} row={f} />)} />}
          </Section>

          <Section title="Folders" note="What each folder holds, biggest first.">
            <View accessibilityRole="header" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
              {[{ id: null as string | null, name: "My files" }, ...r.folder.path].map((p, i, all) => {
                const current = i === all.length - 1
                return (
                  <Fragment key={p.id ?? "root"}>
                    {i > 0 && <CaretRight size={14} color={c.mutedForeground} />}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: current }}
                      disabled={current}
                      onPress={() => setFolder(p.id)}
                      style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 4 }}
                    >
                      <Text variant="bodySmall" color={current ? c.foreground : c.mutedForeground} style={current ? { fontFamily: "Geist_500Medium" } : undefined}>
                        {p.name}
                      </Text>
                    </Pressable>
                  </Fragment>
                )
              })}
              <Text variant="bodySmall" color={c.mutedForeground} style={{ marginLeft: "auto", fontVariant: ["tabular-nums"] }}>
                {formatBytes(r.folder.bytes)}
              </Text>
            </View>
            {r.folder.items.length === 0 ? (
              <Empty>This folder is empty.</Empty>
            ) : (
              <Hairlines
                rows={r.folder.items.map((f) => (
                  <Row
                    key={f.id}
                    row={f}
                    share={r.folder.bytes ? f.size / r.folder.bytes : 0}
                    onPress={f.kind === "folder" ? () => setFolder(f.id) : undefined}
                  />
                ))}
              />
            )}
          </Section>
        </ScrollView>
      )}

      {ask?.kind === "older" && (
        <ConfirmDialog
          title={`Delete older versions of “${ask.row.name}”?`}
          body={`${plural((ask.row.versions ?? 0) - (ask.row.keep ?? 0), "version")} will be deleted for good. Versions kept forever stay.`}
          confirm="Delete versions"
          onClose={() => setAsk(null)}
          onConfirm={() => actions.deleteOlderVersions(ask.row.id, ask.row.name)}
        />
      )}
      {ask?.kind === "empty" && (
        <ConfirmDialog
          title="Empty the trash?"
          body={`${plural(ask.count, "item")} will be deleted for good.`}
          confirm="Empty trash"
          onClose={() => setAsk(null)}
          onConfirm={() => actions.emptyTrash()}
        />
      )}
    </View>
  )
}
