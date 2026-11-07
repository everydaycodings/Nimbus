import { formatBytes } from "@nimbus/shared/file-rules"
import type { TransferResponse } from "@nimbus/shared/api"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { router, useLocalSearchParams } from "expo-router"
import { Copy, ShareNetwork, XCircle } from "phosphor-react-native"
import { useState } from "react"
import { Share, View } from "react-native"

import { ConfirmDialog } from "@/components/dialog"
import { Group, Loaded, Page, Row, Section } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { nameOf, STATUS } from "@/lib/sent"
import { describeUa, EVENT } from "@/lib/share"
import { since } from "@/lib/time"
import { c } from "@/lib/theme"

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const VERB = { ...EVENT, view: "Opened the page", save: "Saved to Nimbus" } as Record<string, string>

// One transfer: its state, the link to copy or share, who downloaded it, and Revoke.
export default function TransferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  const [revoking, setRevoking] = useState(false)
  const q = useQuery({ queryKey: [api.id, "transfer", id], queryFn: () => api.get<TransferResponse>(`/transfers/${id}`) })

  const revoke = async () => {
    try {
      await api.post(`/transfers/${id}/revoke`)
      client.invalidateQueries({ queryKey: [api.id] })
      snack({ text: "Turned off the transfer." })
      router.back()
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <Page title={q.data ? nameOf(q.data.transfer) : "Transfer"}>
      <Loaded query={q}>
        {({ transfer: t, events }) => {
          const url = t.linkToken ? `${api.account.server}/t/${t.linkToken}` : null
          return (
            <>
              <Group>
                <Row label="Status" trailing={<Text color={t.status === "active" ? c.brand : c.mutedForeground}>{STATUS[t.status]}</Text>} />
                <Row label={t.status === "active" ? "Expires" : "Ended"} detail={when(t.expiresAt)} />
                <Row label="Files" detail={`${t.fileCount} ${t.fileCount === 1 ? "file" : "files"} · ${formatBytes(t.bytes)}`} />
                <Row label="Downloads" detail={t.downloadLimit !== null ? `${t.downloads} of ${t.downloadLimit}` : `${t.downloads} · no limit`} />
                {t.hasPassword && <Row label="Password protected" />}
                <Row label="Sent to" detail={t.recipients.map((r) => r.email ?? "Anyone with the link").join(", ")} />
              </Group>
              {t.message && <Text variant="bodySmall" color={c.mutedForeground}>{t.message}</Text>}
              {t.status === "active" && (
                <Group>
                  {url && (
                    <Row
                      label="Copy link"
                      icon={<Copy size={24} color={c.mutedForeground} />}
                      onPress={async () => {
                        await Clipboard.setStringAsync(url)
                        snack({ text: "Copied the link." })
                      }}
                    />
                  )}
                  {url && <Row label="Share link" icon={<ShareNetwork size={24} color={c.mutedForeground} />} onPress={() => Share.share({ message: url }).catch(() => {})} />}
                  <Row label="Revoke" detail="Turns it off now and deletes its copies" danger icon={<XCircle size={24} color={c.destructive} />} onPress={() => setRevoking(true)} />
                </Group>
              )}
              <Section title="Downloaded by…">
                {events.length === 0 ? (
                  <Text variant="bodySmall" color={c.mutedForeground}>Nothing yet.</Text>
                ) : (
                  <Group>
                    {events.map((e) => (
                      <Row
                        key={e.id}
                        label={`${e.who} · ${VERB[e.kind] ?? e.kind}`}
                        detail={[e.kind === "download" && e.detail, since(e.at), e.ip, describeUa(e.ua)].filter(Boolean).join(" · ")}
                      />
                    ))}
                  </Group>
                )}
              </Section>
              <View />
            </>
          )
        }}
      </Loaded>
      {revoking && <ConfirmDialog title="Revoke this transfer?" body="The links stop working now and the copies are deleted." confirm="Revoke" onConfirm={revoke} onClose={() => setRevoking(false)} />}
    </Page>
  )
}
