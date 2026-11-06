// Download and Open with for one file of the vault on screen in the previewer, behind the unencrypted-copy warning.
import type { Item } from "@nimbus/shared/api"
import { useState } from "react"

import { ConfirmDialog } from "@/components/dialog"
import { vaultNative, type VaultNative } from "@/lib/vault"
import { useVaultOps } from "@/lib/vault-ops"
import type { VaultEntry } from "@/lib/vault-rules"

const NONE: VaultEntry[] = []
const noop = () => {}
const asEntry = (i: Item): VaultEntry => ({ id: i.id, parentId: null, kind: "file", name: i.name, mime: i.mime, size: i.size, updatedAt: i.updatedAt, trashedAt: null, encKey: null })

// Null outside a vault. `dialog` has to be rendered by the caller.
export function useVaultItem(vaultId: string | undefined) {
  const [asking, setAsking] = useState<Item | null>(null)
  const ops = useVaultOps(vaultId ?? "", vaultNative as VaultNative, NONE, noop)
  if (!vaultId || !vaultNative) return null
  return {
    download: setAsking,
    openWith: (i: Item) => ops.openWith(asEntry(i)),
    dialog: asking && (
      <ConfirmDialog
        title="Save an unencrypted copy?"
        body="The copy on your phone isn't protected by the vault. Anyone who can open that folder can read it."
        confirm="Save copy"
        danger={false}
        onClose={() => setAsking(null)}
        onConfirm={() => ops.download([asEntry(asking)])}
      />
    ),
  }
}
