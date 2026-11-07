import { formatBytes } from "@nimbus/shared/file-rules"
import { router } from "expo-router"
import { PaperPlaneTilt, Plus } from "phosphor-react-native"
import { View } from "react-native"

import { Caret, Group, Loaded, Page, Row } from "@/components/page"
import { Button, IconButton, Text } from "@/components/ui"
import { nameOf, sendWithTransfer, STATUS, useSent } from "@/lib/sent"
import { c } from "@/lib/theme"

// Transfers I sent: tap one for who downloaded it, its link, and Revoke.
export default function Transfers() {
  const sent = useSent()
  return (
    <Page title="Transfers" trailing={sent.data?.options.enabled ? <IconButton icon={Plus} label="New transfer" onPress={() => sendWithTransfer([])} /> : undefined}>
      <Loaded query={sent}>
        {({ transfers, options }) =>
          !options.enabled ? (
            <Text color={c.mutedForeground}>Your admin turned Transfer off.</Text>
          ) : transfers.length === 0 ? (
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 48 }}>
              <PaperPlaneTilt size={40} color={c.mutedForeground} />
              <Text variant="titleSmall">You haven't sent anything yet</Text>
              <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
                Send files by email or link. Transfers keep their own copy and delete it when they expire.
              </Text>
              <Button label="New transfer" onPress={() => sendWithTransfer([])} />
            </View>
          ) : (
            <Group>
              {transfers.map((t) => (
                <Row
                  key={t.id}
                  label={nameOf(t)}
                  detail={`${t.fileCount} ${t.fileCount === 1 ? "file" : "files"} · ${formatBytes(t.bytes)} · ${t.downloads}${t.downloadLimit !== null ? ` of ${t.downloadLimit}` : ""} ${(t.downloadLimit ?? t.downloads) === 1 ? "download" : "downloads"}`}
                  trailing={
                    <>
                      <Text variant="bodySmall" color={t.status === "active" ? c.brand : c.mutedForeground}>{STATUS[t.status]}</Text>
                      <Caret />
                    </>
                  }
                  onPress={() => router.push({ pathname: "/transfers/[id]", params: { id: t.id } })}
                />
              ))}
            </Group>
          )
        }
      </Loaded>
    </Page>
  )
}
