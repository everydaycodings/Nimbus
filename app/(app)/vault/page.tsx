import { VaultList } from "@/components/vault-list"
import { pageUserId } from "@/lib/files"
import { listVaults, vaultPolicy } from "@/lib/vault"

export const metadata = { title: "Vault · Nimbus" }

export default async function VaultsPage() {
  const me = await pageUserId()
  const [vaults, policy] = await Promise.all([listVaults(me), vaultPolicy()])
  const canCreate =
    policy.enabled && (policy.cap === null || vaults.length < policy.cap)
  return (
    <VaultList
      vaults={vaults}
      canCreate={canCreate}
      why={
        !policy.enabled
          ? "An admin turned off new vaults on this server."
          : canCreate
            ? null
            : `You have the most vaults allowed here (${policy.cap}).`
      }
    />
  )
}
