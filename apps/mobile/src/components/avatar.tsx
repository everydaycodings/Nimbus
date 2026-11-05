import { Image } from "expo-image"
import { View } from "react-native"

import { Text } from "@/components/ui"
import type { Account } from "@/lib/api"
import { c } from "@/lib/theme"

// A provider's photo is a full URL. Presets (/avatars/…) are public files on the
// server, and uploaded pictures (/api/avatar/…) need the session.
function source(a: Pick<Account, "server" | "token">, image: string) {
  if (/^https?:\/\//.test(image)) return { uri: image }
  return { uri: a.server + image, headers: { authorization: `Bearer ${a.token}` } }
}

export function Avatar({
  account,
  name,
  image,
  size = 32,
}: {
  account: Pick<Account, "server" | "token">
  name: string
  image: string | null
  size?: number
}) {
  const box = { width: size, height: size, borderRadius: size / 2 }
  if (image) return <Image source={source(account, image)} style={box} accessibilityIgnoresInvertColors contentFit="cover" />
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return (
    <View style={[box, { backgroundColor: c.muted, alignItems: "center", justifyContent: "center" }]}>
      <Text variant="caption" color={c.mutedForeground} style={{ fontFamily: "Geist_600SemiBold" }} allowFontScaling={false}>
        {initials}
      </Text>
    </View>
  )
}

// "https://files.example.net" reads better as "files.example.net".
export const serverName = (server: string) => server.replace(/^https?:\/\//, "")
