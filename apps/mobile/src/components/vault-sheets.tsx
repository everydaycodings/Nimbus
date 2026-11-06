// Sheets that pick a place or a vault. Shared by the vault browser and the Files screens.
import type { Item } from "@nimbus/shared/api"
import { router } from "expo-router"
import { ArrowLeft, CaretRight, Lock, LockOpen } from "phosphor-react-native"
import { useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

import { FileIcon } from "@/components/file-icon"
import { Sheet, SheetRow, useDismiss } from "@/components/sheet"
import { useVaultLock } from "@/components/vault-lock"
import { Button, Text } from "@/components/ui"
import { useFolders } from "@/lib/files"
import { c } from "@/lib/theme"
import type { Entry } from "@/lib/upload-plan"
import { setIntake, useVaults, vaultNative } from "@/lib/vault"
import { kidsOf, type VaultEntry } from "@/lib/vault-rules"

type Place = { id: string | null; name: string }
type Kids = (parent: string | null) => { pending: boolean; error?: string; folders: { id: string; name: string }[] }

// My files' folders.
export const useMyFolders: Kids = (parent) => {
  const q = useFolders(parent)
  return { pending: q.isPending, error: q.isError ? q.error.message : undefined, folders: q.data?.folders ?? [] }
}

// A vault's folders, leaving out the ones being moved (a folder can't go inside itself).
export const vaultFolders =
  (all: VaultEntry[], moving: VaultEntry[]): Kids =>
  (parent) => ({ pending: false, folders: kidsOf(all, parent).filter((k) => k.kind === "folder" && !moving.some((m) => m.id === k.id)) })

function Pick({ onPick }: { onPick: () => void }) {
  const dismiss = useDismiss()
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
      <Button label="Move here" onPress={() => dismiss(onPick)} />
    </View>
  )
}

// Folders to drill into; "Move here" picks the one on screen.
export function FolderSheet({ root, caption, kids, onPick, onClose }: { root: string; caption: string; kids: Kids; onPick: (place: Place) => void; onClose: () => void }) {
  const [stack, setStack] = useState<Place[]>([{ id: null, name: root }])
  const here = stack[stack.length - 1]
  const q = kids(here.id)
  const header: ReactNode = (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingBottom: 8 }}>
      {stack.length > 1 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          android_ripple={{ color: c.ripple, borderless: true, radius: 24 }}
          onPress={() => setStack((s) => s.slice(0, -1))}
          style={{ width: 48, height: 48, marginLeft: -12, marginRight: -12, alignItems: "center", justifyContent: "center" }}
        >
          <ArrowLeft size={24} color={c.foreground} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text variant="titleSmall" numberOfLines={1}>{here.name}</Text>
        <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{caption}</Text>
      </View>
    </View>
  )
  return (
    <Sheet tall onClose={onClose} header={header} footer={<Pick onPick={() => onPick(here)} />}>
      {q.pending ? (
        <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ margin: 24 }} />
      ) : q.error ? (
        <Text color={c.mutedForeground} style={{ padding: 20 }}>{q.error}</Text>
      ) : q.folders.length === 0 ? (
        <Text color={c.mutedForeground} style={{ padding: 20 }}>No folders here</Text>
      ) : (
        q.folders.map((f) => (
          <SheetRow
            key={f.id}
            stay
            label={f.name}
            icon={<FileIcon item={{ kind: "folder", mime: null, name: f.name }} />}
            trailing={<CaretRight size={20} color={c.mutedForeground} />}
            onPress={() => setStack((s) => [...s, f])}
          />
        ))
      )}
    </Sheet>
  )
}

// Where to put things from Files or from another app: a vault, unlocked first if it's locked.
export function VaultPickSheet({ title, intake, onClose }: { title: string; intake: { items?: Item[]; files?: Entry[]; exit?: boolean }; onClose: () => void }) {
  const q = useVaults()
  const { isOpen } = useVaultLock()
  const header = (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4, minHeight: 56, justifyContent: "center", paddingHorizontal: 20, paddingBottom: 8 }}>
      <Text variant="titleSmall" numberOfLines={1}>{title}</Text>
      <Text variant="caption" color={c.mutedForeground}>They're encrypted on this phone first.</Text>
    </View>
  )
  return (
    <Sheet onClose={onClose} header={header}>
      {q.isPending ? (
        <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ margin: 24 }} />
      ) : !q.data?.vaults.length ? (
        <Text color={c.mutedForeground} style={{ padding: 20 }}>{q.isError ? q.error.message : "You don't have a vault yet. Make one from More, then Vaults."}</Text>
      ) : (
        q.data.vaults.map((v) => {
          const open = isOpen(v.id)
          return (
            <SheetRow
              key={v.id}
              label={v.name}
              detail={open ? "Unlocked" : "Locked"}
              icon={open ? <LockOpen size={24} color={c.brand} /> : <Lock size={24} color={c.mutedForeground} />}
              onPress={() => {
                setIntake({ vaultId: v.id, ...intake })
                router.push({ pathname: open ? "/vault/[id]" : "/vault/[id]/unlock", params: { id: v.id, name: v.name } })
              }}
            />
          )
        })
      )}
    </Sheet>
  )
}

export const canVault = !!vaultNative
