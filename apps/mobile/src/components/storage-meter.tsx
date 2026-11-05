import { HardDrives } from "phosphor-react-native"
import { View } from "react-native"

import { Text } from "@/components/ui"
import { c } from "@/lib/theme"
import { formatBytes } from "@nimbus/shared/file-rules"
import type { Usage } from "@nimbus/shared/api"

// Hues match the file-type icons, so the bar reads like the tiles.
const PARTS = [
  { key: "images", label: "Images", fill: c.file.image },
  { key: "videos", label: "Videos", fill: c.file.video },
  { key: "docs", label: "Docs", fill: c.file.doc },
  { key: "other", label: "Other", fill: c.file.archive },
  { key: "vault", label: "Vault", fill: c.foreground },
  { key: "extra", label: "Versions & trash", fill: c.dim },
] as const

// Used of the quota, split by kind of file. The parent makes it tappable.
// `sizes` adds each part's size to its legend label; `bare` drops the title when the screen has one.
export function StorageMeter({ usage, sizes, bare }: { usage: Usage; sizes?: boolean; bare?: boolean }) {
  const { used, quota } = usage
  const scale = quota ?? used
  const full = quota !== null && used >= quota
  const near = quota !== null && used >= quota * 0.9
  const parts = PARTS.filter((p) => usage[p.key] > 0)
  const share = quota ? (used / quota) * 100 : 0
  const percent = share > 0 && share < 1 ? "<1" : Math.min(100, Math.round(share))
  const summary =
    quota === null
      ? `Storage, ${formatBytes(used)} used`
      : `Storage, ${formatBytes(used)} of ${formatBytes(quota)} used, ${formatBytes(Math.max(0, quota - used))} free`
  const tone = near ? c.destructive : c.mutedForeground

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={summary}
      accessibilityValue={quota === null ? undefined : { min: 0, max: quota, now: Math.min(used, quota) }}
      style={{ gap: 8 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {bare ? (
          <View />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <HardDrives size={20} color={c.mutedForeground} />
            <Text variant="label">Storage</Text>
          </View>
        )}
        <Text variant="bodySmall" color={tone} style={{ fontVariant: ["tabular-nums"] }}>
          {quota === null ? `${formatBytes(used)} used` : `${formatBytes(used)} of ${formatBytes(quota)}`}
        </Text>
      </View>
      <View style={{ flexDirection: "row", height: 6, gap: 1, borderRadius: 3, overflow: "hidden", backgroundColor: c.muted }}>
        {scale > 0 &&
          parts.map((p) => (
            <View key={p.key} style={{ height: 6, minWidth: 2, width: `${(usage[p.key] / scale) * 100}%`, backgroundColor: p.fill }} />
          ))}
      </View>
      {quota !== null && !full && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text variant="caption" color={tone} style={{ fontVariant: ["tabular-nums"] }}>{percent}% used</Text>
          <Text variant="caption" color={tone} style={{ fontVariant: ["tabular-nums"] }}>{formatBytes(quota - used)} free</Text>
        </View>
      )}
      {parts.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
          {parts.map((p) => (
            <View key={p.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.fill }} />
              <Text variant="caption" color={c.mutedForeground} style={sizes ? { fontVariant: ["tabular-nums"] } : undefined}>
                {sizes ? `${p.label} ${formatBytes(usage[p.key])}` : p.label}
              </Text>
            </View>
          ))}
        </View>
      )}
      {full && <Text variant="caption" color={c.destructive}>Full. Uploads stop until space is freed.</Text>}
    </View>
  )
}
