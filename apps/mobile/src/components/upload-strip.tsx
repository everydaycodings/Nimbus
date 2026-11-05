import { router } from "expo-router"
import { CheckCircle, CaretRight, CloudArrowUp, Copy, Warning } from "phosphor-react-native"
import { useEffect, useMemo } from "react"
import { Pressable, View } from "react-native"

import { Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { c, radius } from "@/lib/theme"
import { stripSummary } from "@/lib/upload-plan"
import { engine, useUploadRows } from "@/lib/uploads"

// One line above the tabs while anything's going on. It takes no space when idle, and clears itself
// a few seconds after everything has landed. Failures stay until someone has seen them.
export function UploadStrip({ floating }: { floating?: boolean }) {
  const { active } = useAccounts()
  const rows = useUploadRows(active?.id)
  const s = useMemo(() => stripSummary(rows), [rows])
  const clear = s.finished && rows.length > 0
  useEffect(() => {
    if (!clear || !active) return
    const timer = setTimeout(() => engine.clear(active.id, false), 5000)
    return () => clearTimeout(timer)
  }, [clear, active])
  if (!rows.length) return null
  const Icon = s.failed && !s.active ? Warning : s.dupes && !s.active ? Copy : s.finished ? CheckCircle : CloudArrowUp
  const tint = s.failed && !s.active ? c.destructive : s.finished ? c.brand : c.mutedForeground
  return (
    <View style={[{ backgroundColor: c.card, overflow: "hidden" }, floating ? { borderRadius: radius.card, borderWidth: 1, borderColor: c.border } : { borderTopWidth: 1, borderTopColor: c.border }]}>
      <View importantForAccessibility="no" style={{ height: 2, backgroundColor: s.active ? c.mutedStrong : "transparent" }}>
        {s.active && <View style={{ height: 2, width: `${Math.round(s.progress * 100)}%`, backgroundColor: c.brand }} />}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.text}
        accessibilityHint="Opens your uploads"
        android_ripple={{ color: c.ripple }}
        onPress={() => router.push("/uploads")}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 }}
      >
        <Icon size={20} color={tint} weight={s.finished ? "fill" : "regular"} />
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{s.text}</Text>
        {s.active && (
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{Math.round(s.progress * 100)}%</Text>
        )}
        <CaretRight size={16} color={c.mutedForeground} />
      </Pressable>
    </View>
  )
}
