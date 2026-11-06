import { createContext, use, useCallback, useEffect, type ReactNode } from "react"
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler"
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { scheduleOnRN } from "react-native-worklets"

import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { useOnline } from "@/lib/connectivity"
import { c, radius } from "@/lib/theme"

// Slides the sheet away, then calls onClose, then `after`. A row uses `after` to
// open whatever comes next, so one sheet never sits on top of another.
const Ctx = createContext<(after?: () => void) => void>(() => {})
export const useDismiss = () => use(Ctx)

// Mount it to open it and pass onClose to unmount it. Dragging works on the handle
// and header only, so the scrolling list inside never fights the gesture. Reanimated
// skips the timing when the system's remove-animations setting is on.
export function Sheet({
  onClose,
  header,
  footer,
  tall,
  children,
}: {
  onClose: () => void
  header?: ReactNode
  footer?: ReactNode
  tall?: boolean
  children: ReactNode
}) {
  const inset = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const y = useSharedValue(height)
  const scrim = useSharedValue(0)

  useEffect(() => {
    y.value = withTiming(0, { duration: 240 })
    scrim.value = withTiming(1, { duration: 200 })
  }, [y, scrim])

  const finish = useCallback(
    (after?: () => void) => {
      onClose()
      after?.()
    },
    [onClose]
  )
  const dismiss = useCallback(
    (after?: () => void) => {
      scrim.value = withTiming(0, { duration: 160 })
      y.value = withTiming(height, { duration: 180 }, (done) => {
        if (done) scheduleOnRN(finish, after)
      })
    },
    [finish, height, scrim, y]
  )

  const drag = Gesture.Pan()
    .onChange((e) => {
      y.value = Math.max(0, y.value + e.changeY)
    })
    .onEnd((e) => {
      if (y.value > 96 || e.velocityY > 800) scheduleOnRN(dismiss)
      else y.value = withTiming(0, { duration: 160 })
    })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }))

  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={() => dismiss()}>
      <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={[{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.6)" }, scrimStyle]}>
          <Pressable style={{ flex: 1 }} accessibilityLabel="Close" onPress={() => dismiss()} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            {
              alignSelf: "center",
              width: "100%",
              maxWidth: 640,
              height: tall ? height * 0.88 : undefined,
              maxHeight: height * 0.88,
              backgroundColor: c.card,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              borderColor: c.border,
              borderWidth: 1,
              borderBottomWidth: 0,
              paddingBottom: footer ? 0 : inset.bottom + 8,
            },
            sheetStyle,
          ]}
        >
          <Ctx value={dismiss}>
            <GestureDetector gesture={drag}>
              <View collapsable={false}>
                <View style={{ height: 24, alignItems: "center", justifyContent: "center" }}>
                  <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: c.mutedStrong }} />
                </View>
                {header}
              </View>
            </GestureDetector>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: tall ? 1 : 0 }}>
              {children}
            </ScrollView>
            {footer && <View style={{ paddingBottom: inset.bottom + 8 }}>{footer}</View>}
          </Ctx>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

export const SheetDivider = () => <View style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }} />

// A full-width row. By default it closes the sheet and then runs onPress; `stay`
// keeps the sheet open, for toggles.
export function SheetRow({
  label,
  detail,
  icon,
  trailing,
  danger,
  stay,
  selected,
  needsNet,
  onPress,
}: {
  label: string
  detail?: string
  icon?: ReactNode
  trailing?: ReactNode
  danger?: boolean
  stay?: boolean
  selected?: boolean
  // Greyed with no connection. The reason shows on the row, and tapping closes the sheet and says it again.
  needsNet?: boolean
  onPress: () => void
}) {
  const dismiss = useDismiss()
  const snack = useSnack()
  const online = useOnline()
  const blocked = needsNet && !online
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ ...(selected === undefined ? {} : { selected }), disabled: blocked }}
      android_ripple={{ color: c.ripple }}
      onPress={() => (blocked ? dismiss(() => snack({ text: `${label} needs a connection.` })) : stay ? onPress() : dismiss(onPress))}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingVertical: 8, opacity: blocked ? 0.5 : 1 }}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text variant="body" color={danger ? c.destructive : c.foreground} numberOfLines={1}>
          {label}
        </Text>
        {(blocked || detail) && (
          <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>
            {blocked ? "Needs a connection" : detail}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  )
}
