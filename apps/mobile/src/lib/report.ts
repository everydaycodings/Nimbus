// Builds the Copy diagnostics text. useReport needs the signed-in providers; reportWithoutAccounts works anywhere, even from the crash screen.
import Constants, { ExecutionEnvironment } from "expo-constants"
import { Platform } from "react-native"

import { formatBytes } from "@nimbus/shared/file-rules"
import { useAccounts } from "./accounts"
import { useBackup } from "./backup"
import { describe } from "./backup-rules"
import type { Crash } from "./crash"
import { diagnosticsText } from "./diagnostics"
import { loggedErrors } from "./error-log"
import { native } from "./native"
import { useOffline } from "./offline"
import { pushRoute, refreshPush } from "./push"
import { serverInfo } from "./servers"

const version = Constants.expoConfig?.version ?? "?"
const build = String(Constants.expoConfig?.android?.versionCode ?? "?")
const runtime = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? "Expo Go" : "APK"

function base() {
  const k = Platform.constants as { Release?: string; Model?: string; Brand?: string }
  return {
    app: { version, build, runtime } as const,
    device: { android: k.Release ?? String(Platform.Version), model: [k.Brand, k.Model].filter(Boolean).join(" ") || "unknown" },
    filesApp: typeof native?.setUnlockedAt === "function",
    errors: loggedErrors(),
  }
}

export const reportWithoutAccounts = (crash?: Crash | null) =>
  diagnosticsText({ ...base(), accounts: [], push: "unknown", backup: "unknown", offlineBytes: "unknown", uploadQueue: 0, crash })

export function useReport() {
  const { accounts, active } = useAccounts()
  const backup = useBackup()
  const offline = useOffline(active?.id ?? "")
  return (crash?: Crash | null) => {
    let queued = 0
    try {
      queued = native ? (JSON.parse(native.uploads()) as unknown[]).length : 0
    } catch {}
    return diagnosticsText({
      ...base(),
      accounts: accounts.map((a) => ({ server: a.server, email: a.email, apiVersion: serverInfo(a.id)?.instance.apiVersion, version: serverInfo(a.id)?.instance.version })),
      push: pushRoute(refreshPush()),
      backup: backup.settings.enabled ? describe(backup.status).title : "Off",
      offlineBytes: offline.count ? `${offline.count} files, ${formatBytes(offline.bytes)}` : "Off",
      uploadQueue: queued,
      crash,
    })
  }
}
