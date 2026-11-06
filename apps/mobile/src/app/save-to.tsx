import { formatBytes } from "@nimbus/shared/file-rules"
import { router } from "expo-router"
import { ArrowLeft, CaretRight, Lock, X } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, BackHandler, FlatList, Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Avatar } from "@/components/avatar"
import { FileIcon } from "@/components/file-icon"
import { Sheet, SheetRow } from "@/components/sheet"
import { Bar, Button, IconButton, Text } from "@/components/ui"
import { useUploader } from "@/components/uploader"
import { VaultPickSheet, canVault } from "@/components/vault-sheets"
import { useAccounts } from "@/lib/accounts"
import { useFolders } from "@/lib/files"
import { usePrefs } from "@/lib/prefs"
import { sharedFiles } from "@/lib/share-in"
import { c, radius } from "@/lib/theme"

type Place = { id: string | null; name: string }
const ROOT: Place = { id: null, name: "My files" }

// Share into Nimbus: pick an account and a folder, save, and go back to the app that shared.
export default function SaveTo() {
  const { active } = useAccounts()
  if (!active)
    return (
      <Shell>
        <View style={{ padding: 24, gap: 16 }}>
          <Text>Sign in to Nimbus first, then share again.</Text>
          <Button label="Sign in" onPress={() => router.replace("/connect")} />
        </View>
      </Shell>
    )
  // Keyed by account, so switching starts again at that account's last folder.
  return <Chooser key={active.id} />
}

function Shell({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={X} label="Cancel" onPress={() => (router.canGoBack() ? router.back() : BackHandler.exitApp())} />
        <View style={{ flex: 1 }}>
          <Text variant="title" accessibilityRole="header">Save to Nimbus</Text>
          {caption && <Text variant="caption" color={c.mutedForeground}>{caption}</Text>}
        </View>
      </Bar>
      {children}
    </View>
  )
}

function Chooser() {
  const inset = useSafeAreaInsets()
  const { active, accounts, switchTo } = useAccounts()
  const account = active!
  const [prefs, setPrefs] = usePrefs(account.id)
  const [stack, setStack] = useState<Place[]>(prefs.saveTo?.id ? [ROOT, prefs.saveTo] : [ROOT])
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vaults, setVaults] = useState(false)
  const { send } = useUploader()
  const here = stack[stack.length - 1]
  const q = useFolders(here.id)
  const files = sharedFiles()
  const total = files.reduce((n, f) => n + f.size, 0)
  const caption = files.length === 1 ? `${files[0].name} · ${formatBytes(total)}` : `${files.length} files · ${formatBytes(total)}`

  const save = async () => {
    setBusy(true)
    const ok = await send(account, here.id, files.map((f) => ({ path: f.name, size: f.size, uri: f.uri, mime: f.mime })))
    setBusy(false)
    if (!ok) return
    setPrefs({ saveTo: here })
    // The upload carries on in the background; the person goes back to what they were doing.
    BackHandler.exitApp()
  }

  return (
    <Shell caption={files.length ? caption : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Saving to ${account.email} on ${account.server.replace(/^https?:\/\//, "")}`}
        accessibilityHint={accounts.length > 1 ? "Choose another account" : undefined}
        disabled={accounts.length < 2}
        onPress={() => setAccountsOpen(true)}
        android_ripple={{ color: c.ripple }}
        style={{ marginHorizontal: 16, padding: 12, gap: 12, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.border, borderRadius: radius.card }}
      >
        <Avatar account={account} name={account.name} image={account.image} size={40} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1}>{account.email}</Text>
          <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{account.server.replace(/^https?:\/\//, "")}</Text>
        </View>
        {accounts.length > 1 && <CaretRight size={16} color={c.mutedForeground} />}
      </Pressable>

      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: 4, marginTop: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
        {stack.length > 1 ? <IconButton icon={ArrowLeft} label="Up a folder" onPress={() => setStack((s) => s.slice(0, -1))} /> : <View style={{ width: 12 }} />}
        <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1 }}>{here.name}</Text>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={q.data?.folders ?? []}
        keyExtractor={(f) => f.id}
        ListHeaderComponent={
          canVault && stack.length === 1 && files.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              android_ripple={{ color: c.ripple }}
              onPress={() => setVaults(true)}
              style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20 }}
            >
              <Lock size={24} color={c.brand} />
              <Text style={{ flex: 1 }}>Save to a vault</Text>
              <CaretRight size={20} color={c.mutedForeground} />
            </Pressable>
          ) : undefined
        }
        ListEmptyComponent={
          q.isPending ? (
            <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ margin: 24 }} />
          ) : (
            <Text color={c.mutedForeground} style={{ padding: 20 }}>{q.isError ? q.error.message : "No folders here. Files save in this folder."}</Text>
          )
        }
        renderItem={({ item: f }) => (
          <Pressable
            accessibilityRole="button"
            android_ripple={{ color: c.ripple }}
            onPress={() => setStack((s) => [...s, f])}
            style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20 }}
          >
            <FileIcon item={{ kind: "folder", mime: null, name: f.name }} />
            <Text numberOfLines={1} style={{ flex: 1 }}>{f.name}</Text>
            <CaretRight size={20} color={c.mutedForeground} />
          </Pressable>
        )}
      />

      <View style={{ padding: 16, paddingBottom: inset.bottom + 16, borderTopWidth: 1, borderTopColor: c.border }}>
        <Button label={`Save to ${here.name}`} busy={busy} disabled={!files.length} onPress={save} />
      </View>
      {vaults && (
        <VaultPickSheet
          title="Save to a vault"
          intake={{ files: files.map((f) => ({ path: f.name, size: f.size, uri: f.uri, mime: f.mime })), exit: true }}
          onClose={() => setVaults(false)}
        />
      )}
      {accountsOpen && (
        <Sheet onClose={() => setAccountsOpen(false)}>
          {accounts.map((a) => (
            <SheetRow
              key={a.id}
              selected={a.id === account.id}
              label={a.name}
              detail={`${a.email} · ${a.server.replace(/^https?:\/\//, "")}`}
              icon={<Avatar account={a} name={a.name} image={a.image} size={40} />}
              onPress={() => switchTo(a.id)}
            />
          ))}
        </Sheet>
      )}
    </Shell>
  )
}
