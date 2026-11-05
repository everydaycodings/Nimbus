import { useSegments } from "expo-router"
import { CheckCircle, WarningCircle } from "phosphor-react-native"
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/ui"
import { c, radius } from "@/lib/theme"

export type Snack = { text: string; error?: boolean; undo?: () => void }

const Ctx = createContext<(s: Snack) => void>(() => {})
export const useSnack = () => use(Ctx)

// One slot, like the web's toasts: a new message replaces the old. It sits above
// the FAB, as Material asks, rather than pushing it around.
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<(Snack & { id: number }) | null>(null)
  const next = useRef(0)
  const inset = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const inTabs = useSegments()[0] === "(tabs)"
  const phone = width < 600

  const show = useCallback((s: Snack) => setSnack({ ...s, id: ++next.current }), [])
  useEffect(() => {
    if (!snack) return
    const t = setTimeout(() => setSnack(null), snack.undo ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [snack])
  const value = useMemo(() => show, [show])

  const bottom = inset.bottom + 16 + (inTabs ? (phone ? 80 : 0) + 72 : 0)
  return (
    <Ctx value={value}>
      {children}
      {snack && (
        <Animated.View
          key={snack.id}
          entering={FadeInDown.duration(180)}
          exiting={FadeOutDown.duration(120)}
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            bottom,
            left: phone ? 16 : (inTabs ? 96 : 16),
            right: 16,
            maxWidth: 560,
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingLeft: 14,
            paddingRight: snack.undo ? 4 : 14,
            paddingVertical: 6,
            backgroundColor: c.muted,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: radius.control,
          }}
        >
          {snack.error ? (
            <WarningCircle size={20} color={c.destructive} />
          ) : (
            <CheckCircle size={20} color={c.brand} />
          )}
          <Text variant="bodySmall" numberOfLines={2} style={{ flex: 1 }}>
            {snack.text}
          </Text>
          {snack.undo && (
            <View style={{ borderRadius: radius.control, overflow: "hidden" }}>
              <Pressable
                accessibilityRole="button"
                android_ripple={{ color: c.ripple }}
                onPress={() => {
                  const undo = snack.undo
                  setSnack(null)
                  undo?.()
                }}
                style={{ minHeight: 48, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}
              >
                <Text variant="label" color={c.brand}>Undo</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      )}
    </Ctx>
  )
}
