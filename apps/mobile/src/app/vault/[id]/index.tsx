import { useLocalSearchParams } from "expo-router"

import { Page } from "@/components/page"
import { Text } from "@/components/ui"
import { VaultBrowser } from "@/components/vault-browser"
import { useNeedsUnlock, VaultShell } from "@/components/vault-lock"
import { c } from "@/lib/theme"
import { vaultNative } from "@/lib/vault"

export function VaultScreen({ trash }: { trash?: boolean }) {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const open = useNeedsUnlock(id, name)
  if (!vaultNative) return <Page title="Vault"><Text color={c.mutedForeground}>Vaults need the installed Nimbus app.</Text></Page>
  return <VaultShell>{open && <VaultBrowser vaultId={id} name={name ?? "Vault"} trash={trash} vn={vaultNative} />}</VaultShell>
}

export default function VaultHome() {
  return <VaultScreen />
}
