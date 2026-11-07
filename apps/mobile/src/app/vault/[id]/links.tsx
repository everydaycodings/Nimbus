import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams } from "expo-router"
import { LinkBreak } from "phosphor-react-native"
import { useState } from "react"

import { ConfirmDialog } from "@/components/dialog"
import { Group, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Spinner, Text } from "@/components/ui"
import { useNeedsUnlock, VaultShell } from "@/components/vault-lock"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c } from "@/lib/theme"
import { vaultNative, type VaultNative } from "@/lib/vault"
import { openLabels, useVaultLinks } from "@/lib/vault-links"

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export default function Links() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const open = useNeedsUnlock(id, name)
  if (!vaultNative) return <Page title="Shared links"><Text color={c.mutedForeground}>Vaults need the installed Nimbus app.</Text></Page>
  return <VaultShell>{open && <Body id={id} name={name ?? "Vault"} vn={vaultNative} />}</VaultShell>
}

function Body({ id, name, vn }: { id: string; name: string; vn: VaultNative }) {
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  const links = useVaultLinks(id)
  // Labels are sealed with the vault key, so they're opened here.
  const rows = useQuery({
    queryKey: [api.id, "vault-links", id, "named", links.data?.links.map((l) => l.id).join()],
    queryFn: () => openLabels(api, vn, id, links.data!.links),
    enabled: !!links.data,
  })
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)

  return (
    <Page title="Shared links" caption={name}>
      {links.isError ? (
        <Text color={c.mutedForeground}>{links.error.message}</Text>
      ) : !rows.data ? (
        <Spinner />
      ) : rows.data.length === 0 ? (
        <Text color={c.mutedForeground}>No links yet. Choose a file or folder and tap Share link.</Text>
      ) : (
        <Group>
          {rows.data.map((l) => {
            const expired = !!l.expiresAt && new Date(l.expiresAt) < new Date()
            const when = expired ? "expired" : l.expiresAt ? `expires ${day(l.expiresAt)}` : "no expiry"
            return (
              <Row
                key={l.id}
                label={l.name}
                detail={`${plural(l.files, "file")} · made ${day(l.createdAt)} · ${when} · ${plural(l.viewCount, "view")}${l.passphrase ? " · passphrase" : ""}`}
                icon={<LinkBreak size={24} color={c.mutedForeground} />}
                trailing={<Text variant="label" color={c.destructive}>Revoke</Text>}
                onPress={() => setRevoking({ id: l.id, name: l.name })}
              />
            )
          })}
        </Group>
      )}
      {revoking && (
        <ConfirmDialog
          title="Revoke this link?"
          body={`“${revoking.name}” stops working for good. Anyone who has it loses access.`}
          confirm="Revoke"
          onConfirm={async () => {
            try {
              await api.del(`/vaults/${id}/links/${revoking.id}`)
              client.invalidateQueries({ queryKey: [api.id, "vault-links", id] })
              snack({ text: "Link revoked." })
            } catch (e) {
              snack({ text: errorText(e), error: true })
            }
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </Page>
  )
}
