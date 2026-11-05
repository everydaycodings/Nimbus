import { router } from "expo-router"
import { GearSix, Plus, SignOut } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { Avatar, serverName } from "@/components/avatar"
import { ConfirmDialog } from "@/components/dialog"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { Text } from "@/components/ui"
import { useSnack } from "@/components/snackbar"
import { backupAvailable, readSettings } from "@/lib/backup"
import { useAccounts } from "@/lib/accounts"
import { useMe } from "@/lib/files"
import { c } from "@/lib/theme"

// The dialog lives here, not in a row, so it outlives the sheet closing. The
// sheet is unmounted while it shows; onClose runs once the dialog is done.
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { accounts, active, switchTo, remove } = useAccounts()
  const snack = useSnack()
  const me = useMe()
  const [signingOut, setSigningOut] = useState(false)
  const [sheet, setSheet] = useState(true)
  if (!active) return null

  const plainHttp = active.server.startsWith("http://")
  const name = me.data?.name ?? active.name
  const email = me.data?.email ?? active.email

  const signOut = async () => {
    const backingUp = backupAvailable && readSettings().enabled && readSettings().accountId === active.id
    await remove(active.id)
    // Signing out stops camera backup into that account; say so rather than let it go quiet.
    if (backingUp) snack({ text: `Camera backup stopped, because it was backing up to ${active.email}. Turn it on again in More.` })
    // Another account is now active; with none left the tabs layout goes to /connect.
    if (accounts.length > 1) router.replace("/")
  }

  return (
    <>
      {sheet && (
        <Sheet onClose={onClose}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingVertical: 8 }}>
            <Avatar account={active} name={name} image={me.data?.image ?? active.image} size={56} />
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall" numberOfLines={1}>{name}</Text>
              <Text variant="bodySmall" color={c.mutedForeground} numberOfLines={1}>{email}</Text>
              <Text variant="bodySmall" color={c.mutedForeground} numberOfLines={1}>{serverName(active.server)}</Text>
              {plainHttp && <Text variant="caption" color={c.warning}>Not encrypted</Text>}
            </View>
          </View>
          {accounts.filter((a) => a.id !== active.id).map((a) => (
            <SheetRow
              key={a.id}
              label={a.name}
              detail={`${a.email} · ${serverName(a.server)}`}
              icon={<Avatar account={a} name={a.name} image={a.image} size={40} />}
              onPress={async () => {
                await switchTo(a.id)
                router.replace("/")
              }}
            />
          ))}
          <SheetDivider />
          <SheetRow label="Account settings" icon={<GearSix size={24} color={c.foreground} />} onPress={() => router.push("/account")} />
          <SheetRow label="Add account" icon={<Plus size={24} color={c.foreground} />} onPress={() => router.push("/connect")} />
          <SheetRow
            label="Sign out"
            icon={<SignOut size={24} color={c.foreground} />}
            stay
            onPress={() => {
              setSheet(false)
              setSigningOut(true)
            }}
          />
        </Sheet>
      )}
      {signingOut && (
        <ConfirmDialog
          title={`Sign out of ${email}?`}
          body={`This signs you out of ${serverName(active.server)} on this phone. Your files stay on the server.`}
          confirm="Sign out"
          danger={false}
          onClose={onClose}
          onConfirm={signOut}
        />
      )}
    </>
  )
}
