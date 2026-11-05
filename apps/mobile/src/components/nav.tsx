import type { Tabs } from "expo-router"
import { ClockCounterClockwise, DotsThreeCircle, Folder, Star, UsersThree } from "phosphor-react-native"
import type { ComponentProps } from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/ui"
import { c, radius } from "@/lib/theme"

type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0]

const TABS: Record<string, { label: string; icon: typeof Folder }> = {
  "(files)": { label: "Files", icon: Folder },
  "(recent)": { label: "Recent", icon: ClockCounterClockwise },
  "(shared)": { label: "Shared", icon: UsersThree },
  "(starred)": { label: "Starred", icon: Star },
  more: { label: "More", icon: DotsThreeCircle },
}

export const isWide = (width: number) => width >= 600

// Material's navigation bar on a phone and navigation rail on a tablet. Pressing
// the current tab again goes back to its top, the same as the stock tab bar.
export function NavBar({ state, emitter, navigateToTab }: BarProps) {
  const inset = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const wide = isWide(width)
  return (
    <View
      accessibilityRole="tablist"
      style={
        wide
          ? {
              width: 80 + inset.left,
              paddingLeft: inset.left,
              paddingTop: inset.top + 16,
              gap: 12,
              backgroundColor: c.card,
              borderRightColor: c.border,
              borderRightWidth: 1,
            }
          : {
              flexDirection: "row",
              paddingBottom: inset.bottom,
              backgroundColor: c.card,
              borderTopColor: c.border,
              borderTopWidth: 1,
            }
      }
    >
      {state.routes.map((route, i) => {
        const tab = TABS[route.name]
        if (!tab) return null
        const focused = state.index === i
        const press = () => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigateToTab(route.key)
        }
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            onPress={press}
            android_ripple={{ color: c.ripple }}
            style={{ flex: wide ? 0 : 1, minHeight: 72, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8 }}
          >
            <View
              style={{
                width: 56,
                height: 32,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: focused ? c.mutedStrong : "transparent",
              }}
            >
              <tab.icon size={22} color={focused ? c.foreground : c.mutedForeground} weight={focused ? "fill" : "regular"} />
            </View>
            <Text variant="caption" color={focused ? c.foreground : c.mutedForeground} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
