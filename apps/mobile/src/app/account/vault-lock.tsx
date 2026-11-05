import type { AccountResponse } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { Check } from "phosphor-react-native"

import { Group, Loaded, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useApi } from "@/lib/files"
import { c } from "@/lib/theme"

export default function VaultLock() {
  const api = useApi()
  const account = useAccountData()
  const client = useQueryClient()
  const snack = useSnack()
  const key = [api.id, "account"]

  const pick = async (minutes: number) => {
    client.setQueryData<AccountResponse>(key, (a) => a && { ...a, vaultLockMinutes: minutes })
    try {
      await api.put("/account/vault-lock", { minutes })
      snack({ text: `Vaults now lock after ${minutes} minutes idle.` })
    } catch (e) {
      snack({ text: errorText(e), error: true })
      client.invalidateQueries({ queryKey: key })
    }
  }

  return (
    <Page title="Vault lock">
      <Text variant="bodySmall" color={c.mutedForeground}>Unlocked vaults lock themselves when you leave them alone for a while.</Text>
      <Loaded query={account}>
        {(a) => (
          <Group>
            {[5, 15, 30, 60].map((m) => (
              <Row
                key={m}
                label={`${m} minutes idle`}
                trailing={a.vaultLockMinutes === m ? <Check size={24} color={c.brand} /> : undefined}
                onPress={() => a.vaultLockMinutes !== m && pick(m)}
              />
            ))}
          </Group>
        )}
      </Loaded>
    </Page>
  )
}
