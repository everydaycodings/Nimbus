import { Eye, EyeSlash, WarningCircle } from "phosphor-react-native"
import Animated, { useAnimatedStyle, withTiming, type SharedValue } from "react-native-reanimated"
import { useState, type ComponentRef, type ComponentType, type ReactNode, type Ref } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { c, radius, type } from "@/lib/theme"

export function Text({
  variant = "body",
  color = c.foreground,
  style,
  ...rest
}: TextProps & { variant?: keyof typeof type; color?: string }) {
  return <RNText {...rest} style={[type[variant], { color }, style]} />
}

const BUTTON = {
  filled: { bg: c.primary, fg: c.primaryForeground, border: "transparent" },
  outlined: { bg: "transparent", fg: c.foreground, border: c.input },
  text: { bg: "transparent", fg: c.foreground, border: "transparent" },
}

export function Button({
  label,
  onPress,
  variant = "filled",
  busy,
  disabled,
  icon,
  danger,
}: {
  label: string
  onPress: () => void
  variant?: keyof typeof BUTTON
  busy?: boolean
  disabled?: boolean
  icon?: ReactNode
  // Destructive text on the outlined and text variants.
  danger?: boolean
}) {
  const b = BUTTON[variant]
  const fg = danger && variant !== "filled" ? c.destructive : b.fg
  const off = disabled || busy
  return (
    <View style={{ borderRadius: radius.control, overflow: "hidden", opacity: disabled ? 0.5 : 1 }}>
      <Pressable
        onPress={onPress}
        disabled={off}
        android_ripple={{ color: variant === "filled" ? "rgba(0,0,0,0.12)" : c.ripple }}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off, busy: !!busy }}
        style={{
          minHeight: 48,
          paddingHorizontal: 20,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          backgroundColor: b.bg,
          borderColor: b.border,
          borderWidth: variant === "outlined" ? 1 : 0,
          borderRadius: radius.control,
        }}
      >
        {busy ? <ActivityIndicator size="small" color={fg} /> : icon}
        <Text variant="label" color={fg}>
          {label}
        </Text>
      </Pressable>
    </View>
  )
}

export type InputRef = ComponentRef<typeof TextInput>

export function Field({
  label,
  error,
  hint,
  secret,
  ref,
  ...input
}: TextInputProps & {
  label: string
  error?: string | null
  hint?: string
  secret?: boolean
  ref?: Ref<InputRef>
}) {
  const [focused, setFocused] = useState(false)
  const [shown, setShown] = useState(false)
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 52,
          borderRadius: radius.control,
          borderWidth: 1,
          borderColor: error ? c.destructive : focused ? c.brand : c.input,
          backgroundColor: "rgba(255,255,255,0.03)",
        }}
      >
        <TextInput
          {...input}
          ref={ref}
          submitBehavior={input.returnKeyType === "next" ? "submit" : undefined}
          accessibilityLabel={label}
          secureTextEntry={secret && !shown}
          placeholderTextColor={c.mutedForeground}
          selectionColor={c.brand}
          cursorColor={c.brand}
          onFocus={(e) => {
            setFocused(true)
            input.onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            input.onBlur?.(e)
          }}
          style={[type.body, { flex: 1, color: c.foreground, paddingHorizontal: 14, paddingVertical: 12 }]}
        />
        {secret && (
          <Pressable
            onPress={() => setShown((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel={shown ? "Hide password" : "Show password"}
            style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
          >
            {shown ? <EyeSlash size={22} color={c.mutedForeground} /> : <Eye size={22} color={c.mutedForeground} />}
          </Pressable>
        )}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : hint ? (
        <Text variant="caption" color={c.mutedForeground}>{hint}</Text>
      ) : null}
    </View>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 6 }}>
      <WarningCircle size={16} color={c.destructive} style={{ marginTop: 2 }} />
      <Text variant="bodySmall" color={c.destructive} style={{ flex: 1 }}>{children}</Text>
    </View>
  )
}

// A scrolling page for forms and status screens: edge to edge, clear of the
// system bars and the keyboard, and centered when it fits.
export function FormScreen({ children }: { children: ReactNode }) {
  const inset = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignSelf: "center",
          width: "100%",
          maxWidth: 480,
          paddingTop: inset.top + 24,
          paddingBottom: inset.bottom + 24,
          paddingHorizontal: 24,
          gap: 24,
        }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export const Spinner = () => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background }}>
    <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" />
  </View>
)

// The app bar of the pushed screens, so titles sit in the same place on all of them.
export const Bar = ({ children }: { children: ReactNode }) => {
  const inset = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: inset.top, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", minHeight: 64 + inset.top, gap: 4 }}>
      {children}
    </View>
  )
}

// Flat extended FAB. Pass `extended` to shrink it to the icon; the label stays visible without it.
export function Fab({
  label,
  icon,
  onPress,
  extended,
  style,
}: {
  label: string
  icon: ReactNode
  onPress: () => void
  extended?: SharedValue<number>
  style?: object
}) {
  const labelStyle = useAnimatedStyle(() => ({
    maxWidth: extended ? withTiming(extended.value ? 80 : 0) : 80,
    opacity: extended ? withTiming(extended.value) : 1,
  }))
  return (
    <View style={[{ position: "absolute", right: 16, bottom: 16, borderRadius: 16, overflow: "hidden" }, style]}>
      <Pressable
        onPress={onPress}
        android_ripple={{ color: "rgba(0,0,0,0.12)" }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ height: 56, minWidth: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.primary }}
      >
        {icon}
        <Animated.View style={[{ overflow: "hidden" }, labelStyle]}>
          <Text variant="label" color={c.primaryForeground} numberOfLines={1} style={{ paddingLeft: 8 }}>
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    </View>
  )
}

type Icon = ComponentType<{ size?: number; color?: string; weight?: "regular" | "bold" | "fill" }>

export function IconButton({ icon: I, label, onPress, color = c.foreground }: { icon: Icon; label: string; onPress: () => void; color?: string }) {
  return (
    <View style={{ borderRadius: 24, overflow: "hidden" }}>
      <Pressable
        onPress={onPress}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
      >
        <I size={24} color={color} />
      </Pressable>
    </View>
  )
}
