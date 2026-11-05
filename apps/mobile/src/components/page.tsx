import { router } from "expo-router"
import { ArrowLeft, CaretRight } from "phosphor-react-native"
import { Children, Fragment, type ReactNode } from "react"
import { KeyboardAvoidingView, Pressable, ScrollView, Switch, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Bar, Button, IconButton, Spinner, Text } from "@/components/ui"
import { c, radius } from "@/lib/theme"

// A pushed screen: back bar and a scrolling body clear of the system bars and keyboard.
export function Page({
  title,
  caption,
  trailing,
  onBack,
  children,
}: {
  title: string
  caption?: string
  trailing?: ReactNode
  // Leave it out for the usual Back. Pass null where going back would lose something.
  onBack?: (() => void) | null
  children: ReactNode
}) {
  const inset = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        {onBack === null ? <View style={{ width: 12 }} /> : <IconButton icon={ArrowLeft} label="Back" onPress={onBack ?? (() => router.back())} />}
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">{title}</Text>
          {caption && <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{caption}</Text>}
        </View>
        {trailing}
      </Bar>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 640, padding: 16, paddingBottom: inset.bottom + 24, gap: 24 }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// One titled block of a page.
export function Section({ title, note, trailing, children }: { title?: string; note?: string; trailing?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      {(title || trailing) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
          <Text variant="titleSmall" accessibilityRole="header" style={{ flex: 1 }}>{title}</Text>
          {trailing}
        </View>
      )}
      {note && <Text variant="bodySmall" color={c.mutedForeground}>{note}</Text>}
      {children}
    </View>
  )
}

// Outlined list with hairlines between its rows.
export function Group({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children)
  if (!rows.length) return null
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: "hidden" }}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={{ height: 1, backgroundColor: c.border }} />}
          {row}
        </Fragment>
      ))}
    </View>
  )
}

export const Caret = () => <CaretRight size={16} color={c.mutedForeground} />

export function Row({
  label,
  detail,
  icon,
  trailing,
  danger,
  disabled,
  onPress,
}: {
  label: string
  detail?: string | null
  icon?: ReactNode
  trailing?: ReactNode
  danger?: boolean
  disabled?: boolean
  onPress?: () => void
}) {
  const body = (
    <>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text color={danger ? c.destructive : c.foreground}>{label}</Text>
        {detail ? <Text variant="caption" color={c.mutedForeground}>{detail}</Text> : null}
      </View>
      {trailing}
    </>
  )
  const box = { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingVertical: 8, opacity: disabled ? 0.5 : 1 } as const
  if (!onPress) return <View style={box}>{body}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} android_ripple={{ color: c.ripple }} onPress={onPress} style={box}>
      {body}
    </Pressable>
  )
}

// The whole row toggles, and TalkBack hears one switch.
export function SwitchRow({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string
  detail?: string
  value: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      android_ripple={{ color: c.ripple }}
      onPress={() => onChange(!value)}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text>{label}</Text>
        {detail && <Text variant="caption" color={c.mutedForeground}>{detail}</Text>}
      </View>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <Switch value={value} trackColor={{ true: c.brand, false: c.mutedStrong }} thumbColor={c.foreground} />
      </View>
    </Pressable>
  )
}

// Loading and failure for a screen built on one query.
export function Loaded<T>({
  query,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; isFetching: boolean; error: Error | null; refetch: () => unknown }
  children: (data: T) => ReactNode
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>
  if (query.isPending) return <View style={{ height: 160 }}><Spinner /></View>
  return (
    <View style={{ gap: 12, alignItems: "flex-start" }}>
      <Text color={c.mutedForeground}>{query.error?.message}</Text>
      <Button variant="outlined" label="Try again" busy={query.isFetching} onPress={() => query.refetch()} />
    </View>
  )
}
