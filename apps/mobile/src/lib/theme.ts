// DESIGN.md's tokens as hex: React Native has no oklch.
export const c = {
  background: "#0a0a0a",
  card: "#171717",
  muted: "#262626",
  mutedStrong: "#404040",
  border: "rgba(255,255,255,0.1)",
  input: "rgba(255,255,255,0.15)",
  foreground: "#fafafa",
  mutedForeground: "#a1a1a1",
  dim: "#6b6b6b",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  brand: "#5fd0bb",
  brandWash: "rgba(95,208,187,0.08)",
  destructive: "#ff6467",
  warning: "#eeb04a",
  ripple: "rgba(255,255,255,0.1)",
  file: {
    folder: "#f2c063",
    image: "#f27fb2",
    video: "#b08cff",
    doc: "#6ea8ff",
    pdf: "#ff6f6f",
    audio: "#4fd1a5",
    code: "#ff9f66",
    archive: "#b5b5b5",
    other: "#a1a1a1",
  },
  tag: {
    red: "#ff6b6b",
    orange: "#ffa94d",
    yellow: "#ffd43b",
    green: "#69db7c",
    blue: "#4dabf7",
    purple: "#b197fc",
    pink: "#f783ac",
    teal: "#38d9a9",
    indigo: "#748ffc",
    brown: "#c8a27c",
    gray: "#adb5bd",
  },
}

export const font = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  mono: "GeistMono_400Regular",
}

// Material's type roles, set in Geist. Sizes are sp: they follow the system font size.
export const type = {
  headline: { fontFamily: font.semibold, fontSize: 28, lineHeight: 36, letterSpacing: -0.3 },
  title: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28 },
  titleSmall: { fontFamily: font.medium, fontSize: 16, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  bodySmall: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
} as const

export const radius = { control: 10, card: 12, sheet: 28, pill: 999 }
