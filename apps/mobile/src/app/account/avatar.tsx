import type { AvatarsResponse } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { File } from "expo-file-system"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"
import * as ImagePicker from "expo-image-picker"
import { router } from "expo-router"
import { Check, UploadSimple } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, useWindowDimensions, View } from "react-native"

import { Avatar } from "@/components/avatar"
import { Loaded, Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { ErrorText, Text } from "@/components/ui"
import { whilePicking } from "@/lib/picking"
import { errorText, json } from "@/lib/api"
import { useApi, useFileActions } from "@/lib/files"
import { c } from "@/lib/theme"

const SIZE = 256
const COLUMNS = 4
const GAP = 12

export default function AvatarPicker() {
  const api = useApi()
  const actions = useFileActions()
  const snack = useSnack()
  const { width } = useWindowDimensions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const avatars = useQuery({ queryKey: [api.id, "avatars"], gcTime: 0, queryFn: () => api.get<AvatarsResponse>("/account/avatars") })
  const tile = (Math.min(width, 640) - 32 - GAP * (COLUMNS - 1)) / COLUMNS

  const save = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      actions.refresh()
      snack({ text: "Avatar updated." })
      router.back()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const upload = async () => {
    const picked = await whilePicking(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1] }))
    const uri = picked.assets?.[0]?.uri
    if (picked.canceled || !uri) return
    save(async () => {
      const image = await ImageManipulator.manipulate(uri).resize({ width: SIZE, height: SIZE }).renderAsync()
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })
      const file = new File(saved.uri)
      const form = new FormData()
      // Expo's fetch takes anything with bytes(), not React Native's { uri }.
      form.append("file", { name: "avatar.jpg", type: "image/jpeg", bytes: () => file.bytes() } as unknown as Blob)
      await json(api.account.server, "/api/v1/account/avatar", { method: "POST", token: api.account.token, body: form })
    })
  }

  return (
    <Page title="Choose an avatar" trailing={busy ? <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Saving" style={{ marginRight: 16 }} /> : undefined}>
      <Text variant="bodySmall" color={c.mutedForeground}>Shown next to your name in Nimbus, to you and the people you share with.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <Loaded query={avatars}>
        {(a) => {
          const options = [...(a.provider ? [{ value: "provider", image: a.provider }] : []), ...a.presets.map((p) => ({ value: p, image: p }))]
          return (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose a photo from this phone"
                disabled={busy}
                android_ripple={{ color: c.ripple }}
                onPress={upload}
                style={{ width: tile, height: tile, borderRadius: tile / 2, borderWidth: 1, borderStyle: "dashed", borderColor: c.input, alignItems: "center", justifyContent: "center", gap: 2 }}
              >
                <UploadSimple size={22} color={c.mutedForeground} />
                <Text variant="caption" color={c.mutedForeground}>Photo</Text>
              </Pressable>
              {options.map((o, i) => {
                const current = o.image === a.current
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="button"
                    accessibilityLabel={o.value === "provider" ? "Your photo from sign-up" : `Preset avatar ${i + 1}`}
                    accessibilityState={{ selected: current }}
                    disabled={busy || current}
                    onPress={() => save(() => api.put("/account/avatar", { choice: o.value }))}
                    style={{ width: tile, height: tile }}
                  >
                    <Avatar account={api.account} name="" image={o.image} size={tile} />
                    {current && (
                      <>
                        <View pointerEvents="none" style={{ position: "absolute", inset: -2, borderRadius: tile, borderWidth: 2, borderColor: c.brand }} />
                        <View style={{ position: "absolute", right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: c.brand }}>
                          <Check size={14} weight="bold" color={c.primaryForeground} />
                        </View>
                      </>
                    )}
                  </Pressable>
                )
              })}
            </View>
          )
        }}
      </Loaded>
    </Page>
  )
}
