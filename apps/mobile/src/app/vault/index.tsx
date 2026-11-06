import { formatBytes } from "@nimbus/shared/file-rules"
import { router } from "expo-router"
import { Lock, LockOpen, Plus } from "phosphor-react-native"

import { Caret, Group, Loaded, Page, Row } from "@/components/page"
import { Button, Text } from "@/components/ui"
import { useVaultLock } from "@/components/vault-lock"
import { useAccountData, useMe } from "@/lib/files"
import { c } from "@/lib/theme"
import { useVaults, vaultNative } from "@/lib/vault"

export default function Vaults() {
  if (!vaultNative)
    return (
      <Page title="Vaults">
        <Text color={c.mutedForeground}>Vaults need the installed Nimbus app. They can't open in Expo Go.</Text>
      </Page>
    )
  return <List />
}

function List() {
  const q = useVaults()
  const me = useMe()
  const { isOpen } = useVaultLock()
  // The idle minutes the lock timer reads.
  useAccountData()
  const off = me.data && !me.data.vaultsEnabled
  return (
    <Page title="Vaults" caption="Encrypted on this phone">
      {off ? (
        <Text color={c.mutedForeground}>Vaults are turned off on this server.</Text>
      ) : (
        <Loaded query={q}>
          {(d) => (
            <>
              <Text variant="bodySmall" color={c.mutedForeground}>
                Names and contents are encrypted with your passphrase. Nimbus can't read them, and can't recover them if you lose both the passphrase and the recovery code.
              </Text>
              {d.vaults.length > 0 && (
                <Group>
                  {d.vaults.map((v) => {
                    const open = isOpen(v.id)
                    return (
                      <Row
                        key={v.id}
                        label={v.name}
                        detail={`${open ? "Unlocked" : "Locked"} · ${v.items} item${v.items === 1 ? "" : "s"} · ${formatBytes(v.bytes)}`}
                        icon={open ? <LockOpen size={24} color={c.brand} /> : <Lock size={24} color={c.mutedForeground} />}
                        trailing={<Caret />}
                        onPress={() => router.push({ pathname: open ? "/vault/[id]" : "/vault/[id]/unlock", params: { id: v.id, name: v.name } })}
                      />
                    )
                  })}
                </Group>
              )}
              {d.vaults.length === 0 && <Text color={c.mutedForeground}>You don't have a vault yet.</Text>}
              {d.canCreate ? (
                <Button label="New vault" icon={<Plus size={20} color={c.primaryForeground} />} onPress={() => router.push("/vault/new")} />
              ) : (
                d.why && <Text variant="bodySmall" color={c.mutedForeground}>{d.why}</Text>
              )}
            </>
          )}
        </Loaded>
      )}
    </Page>
  )
}
