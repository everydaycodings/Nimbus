import { notFound } from "next/navigation"

import { VaultView } from "@/components/vault-browser"
import { pageUserId, viewPrefs } from "@/lib/files"
import { uploadLimits } from "@/lib/uploads"
import { getVault } from "@/lib/vault"

export const metadata = { title: "Vault · Nimbus" }

export default async function VaultPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const me = await pageUserId()
  const { id } = await params
  const vault = await getVault(me, id)
  if (!vault) notFound()
  const [prefs, limits] = await Promise.all([viewPrefs(), uploadLimits()])
  return (
    <VaultView
      key={vault.id}
      vault={{
        id: vault.id,
        name: vault.name,
        salt: vault.salt,
        wrapped: vault.wrappedKey,
        recoveryWrapped: vault.recoveryWrappedKey,
        kdf: { t: vault.kdfIterations, m: vault.kdfMemory },
      }}
      blocked={limits.blockedExtensions}
      {...prefs}
    />
  )
}
