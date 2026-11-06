import * as Clipboard from "expo-clipboard"
import Constants, { ExecutionEnvironment } from "expo-constants"
import { ArrowSquareOut, Copy, GithubLogo } from "phosphor-react-native"
import { Linking, Platform, View } from "react-native"

import { BrandMark } from "@/components/brand"
import { Group, Page, Row, Section } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { formatBytes } from "@nimbus/shared/file-rules"
import { useAccounts } from "@/lib/accounts"
import { useBackup } from "@/lib/backup"
import { describe } from "@/lib/backup-rules"
import { diagnosticsText } from "@/lib/diagnostics"
import { loggedErrors } from "@/lib/error-log"
import { native } from "@/lib/native"
import { useOffline } from "@/lib/offline"
import { pushRoute, refreshPush } from "@/lib/push"
import { serverInfo } from "@/lib/servers"
import { c } from "@/lib/theme"

const SOURCE = "https://github.com/everydaycodings/Nimbus"

// Key open-source pieces the app is built on.
const LICENCES: [string, string][] = [
  ["React Native, React, Expo", "MIT"],
  ["TanStack Query", "MIT"],
  ["Reanimated, Gesture Handler, Screens, SVG", "MIT"],
  ["Phosphor icons", "MIT"],
  ["tus-js-client", "MIT"],
  ["pdf.js", "Apache 2.0"],
  ["Geist fonts", "SIL OFL 1.1"],
  ["OkHttp, WorkManager, UnifiedPush connector", "Apache 2.0"],
  ["Bouncy Castle", "MIT"],
]

const version = Constants.expoConfig?.version ?? "?"
const build = String(Constants.expoConfig?.android?.versionCode ?? "?")
const runtime = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? "Expo Go" : "APK"

export default function About() {
  const { accounts, active } = useAccounts()
  const backup = useBackup()
  const offline = useOffline(active?.id ?? "")
  const snack = useSnack()

  const copy = async () => {
    let queued = 0
    try {
      queued = native ? (JSON.parse(native.uploads()) as unknown[]).length : 0
    } catch {}
    const k = Platform.constants as { Release?: string; Model?: string; Brand?: string }
    const text = diagnosticsText({
      app: { version, build, runtime },
      device: { android: k.Release ?? String(Platform.Version), model: [k.Brand, k.Model].filter(Boolean).join(" ") || "unknown" },
      accounts: accounts.map((a) => ({ server: a.server, email: a.email, apiVersion: serverInfo(a.id)?.instance.apiVersion, version: serverInfo(a.id)?.instance.version })),
      push: pushRoute(refreshPush()),
      backup: backup.settings.enabled ? describe(backup.status).title : "Off",
      offlineBytes: offline.count ? `${offline.count} files, ${formatBytes(offline.bytes)}` : "Off",
      uploadQueue: queued,
      filesApp: typeof native?.setUnlockedAt === "function",
      errors: loggedErrors(),
    })
    await Clipboard.setStringAsync(text)
    snack({ text: "Copied. Server addresses and emails are shortened." })
  }

  return (
    <Page title="About">
      <View style={{ alignItems: "center", gap: 8 }}>
        <BrandMark />
        <Text variant="title">Nimbus</Text>
        <Text variant="bodySmall" color={c.mutedForeground}>
          Version {version} (build {build})
        </Text>
      </View>
      <Group>
        <Row label="Source code" detail="github.com/everydaycodings/Nimbus" icon={<GithubLogo size={24} color={c.mutedForeground} />} trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />} onPress={() => Linking.openURL(SOURCE)} />
        <Row label="Copy diagnostics" detail="For bug reports: versions, settings and recent errors" icon={<Copy size={24} color={c.mutedForeground} />} onPress={copy} />
      </Group>
      <Section title="Open-source licences">
        <Group>
          {LICENCES.map(([name, licence]) => (
            <Row key={name} label={name} trailing={<Text variant="bodySmall" color={c.mutedForeground}>{licence}</Text>} />
          ))}
        </Group>
      </Section>
    </Page>
  )
}
