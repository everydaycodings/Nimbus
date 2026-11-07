import { formatBytes } from "@nimbus/shared/file-rules"
import * as Clipboard from "expo-clipboard"
import Constants from "expo-constants"
import { Directory, File, Paths } from "expo-file-system"
import { router } from "expo-router"
import { ArrowCircleUp, ArrowSquareOut, Copy, GithubLogo, Globe, Scales } from "phosphor-react-native"
import { useEffect, useRef, useState } from "react"
import { AppState, Image, Linking, ScrollView, View } from "react-native"

import { BrandMark } from "@/components/brand"
import { Actions, Frame } from "@/components/dialog"
import { Caret, Group, Page, Row, Section } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Spinner, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { errorText, json } from "@/lib/api"
import { pendingCrash } from "@/lib/crash"
import { fetchTo } from "@/lib/file-cache"
import { native } from "@/lib/native"
import { useReport } from "@/lib/report"
import { c, radius } from "@/lib/theme"
import { newer, pickApk, unwrapNotes, type Release } from "@/lib/update-rules"

const SOURCE = "https://github.com/everydaycodings/Nimbus"
// Bundled, so the About screen works offline and never asks github.com for the photo.
const CREATOR_PHOTO = require("../../assets/creator.webp")

const version = Constants.expoConfig?.version ?? "?"
const build = String(Constants.expoConfig?.android?.versionCode ?? "?")

type Found = { version: string; notes?: string; url: string; size: number }

export default function About() {
  const snack = useSnack()
  const report = useReport()
  const { active } = useAccounts()
  const [checking, setChecking] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  // Asks this account's server, which offers the newest GitHub release (or the APKs it was installed with).
  const check = async () => {
    if (!active) return
    setChecking(true)
    try {
      const release = await json<Release | null>(active.server, `/api/android/latest?at=${Date.now()}`) // past the 5-minute HTTP cache
      const apk = release && newer(release.version, version) ? pickApk(release, native?.abi?.() ?? null, active.server) : null
      if (apk) setFound({ version: release!.version, notes: release!.notes, url: apk.url, size: apk.size })
      else snack({ text: `You have the latest version (${version}).` })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setChecking(false)
  }
  const copy = async () => {
    const text = report(pendingCrash())
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
        {active && (
          <Row
            label="Check for updates"
            detail={`You have ${version}`}
            icon={<ArrowCircleUp size={24} color={c.mutedForeground} />}
            trailing={checking ? <Spinner /> : undefined}
            disabled={checking}
            onPress={check}
          />
        )}
        <Row label="Source code" detail="github.com/everydaycodings/Nimbus" icon={<GithubLogo size={24} color={c.mutedForeground} />} trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />} onPress={() => Linking.openURL(SOURCE)} />
        <Row label="Copy diagnostics" detail="For bug reports: versions, settings and recent errors" icon={<Copy size={24} color={c.mutedForeground} />} onPress={copy} />
        <Row label="Open-source licences" detail="What Nimbus is built on" icon={<Scales size={24} color={c.mutedForeground} />} trailing={<Caret />} onPress={() => router.push("/licences")} />
      </Group>
      <Section title="Made by">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 4 }}>
          <Image
            source={CREATOR_PHOTO}
            accessibilityIgnoresInvertColors
            style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: c.border }}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="titleSmall">everydaycodings</Text>
            <Text variant="bodySmall" color={c.mutedForeground}>Creator of Nimbus</Text>
          </View>
        </View>
        <Group>
          <Row label="GitHub" detail="github.com/everydaycodings" icon={<GithubLogo size={24} color={c.mutedForeground} />} trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />} onPress={() => Linking.openURL("https://github.com/everydaycodings")} />
          <Row label="Website" detail="everydaycodings.com" icon={<Globe size={24} color={c.mutedForeground} />} trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />} onPress={() => Linking.openURL("https://everydaycodings.com")} />
        </Group>
      </Section>
      {found && <UpdateDialog update={found} onClose={() => setFound(null)} />}
    </Page>
  )
}

// What's new, then download with progress, then Android's installer (it asks to confirm; the app restarts updated).
function UpdateDialog({ update, onClose }: { update: Found; onClose: () => void }) {
  const [sent, setSent] = useState<number | null>(null)
  const [apk, setApk] = useState<File | null>(null)
  const [needsAllow, setNeedsAllow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const canInstall = typeof native?.installApk === "function"

  const install = (file: File) => {
    if (native?.canInstallApps?.() === false) return setNeedsAllow(true)
    setNeedsAllow(false)
    native!.installApk!(file.uri)
  }
  // Back from the "Install unknown apps" switch: carry on if it was turned on.
  useEffect(() => {
    if (!needsAllow || !apk) return
    const sub = AppState.addEventListener("change", (s) => s === "active" && native?.canInstallApps?.() && install(apk))
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAllow, apk])

  const download = async () => {
    // An older APK has no installer bridge: the browser downloads it instead.
    if (!canInstall) return Linking.openURL(update.url)
    setError(null)
    setSent(0)
    abort.current = new AbortController()
    try {
      // Only the newest download is kept; an installed one is no use.
      const dir = new Directory(Paths.cache, "updates")
      if (dir.exists) dir.delete()
      const file = await fetchTo(new File(Paths.cache, "updates", `nimbus-${update.version}.apk`), async () => update.url, {
        signal: abort.current.signal,
        onProgress: (bytes) => setSent(bytes),
      })
      setApk(file)
      install(file)
    } catch (e) {
      if (!abort.current.signal.aborted) setError(errorText(e))
    }
    setSent(null)
  }

  const pct = sent === null ? 0 : Math.min(100, Math.round((sent / (update.size || 1)) * 100))
  return (
    <Frame title={`Nimbus ${update.version} is available`} onClose={onClose}>
      <Text variant="bodySmall" color={c.mutedForeground}>You have {version}. Download · {formatBytes(update.size)}</Text>
      {update.notes && (
        <ScrollView style={{ maxHeight: 240, borderWidth: 1, borderColor: c.border, borderRadius: radius.control }} contentContainerStyle={{ padding: 12 }}>
          <Text variant="bodySmall">{unwrapNotes(update.notes)}</Text>
        </ScrollView>
      )}
      {sent !== null && (
        <View accessibilityLabel={`Downloading, ${pct} percent`} style={{ gap: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.mutedStrong }}>
            <View style={{ height: 4, borderRadius: 2, width: `${pct}%`, backgroundColor: c.brand }} />
          </View>
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{formatBytes(sent)} of {formatBytes(update.size)}</Text>
        </View>
      )}
      {needsAllow && (
        <Text variant="bodySmall" color={c.mutedForeground}>Android needs your OK once: turn on "Allow from this source" for Nimbus, then come back.</Text>
      )}
      {error && <Text variant="bodySmall" color={c.destructive}>{error}</Text>}
      <Actions>
        <Button variant="text" label={sent !== null ? "Cancel" : "Later"} onPress={onClose} />
        {needsAllow ? (
          <Button label="Open settings" onPress={() => native?.allowInstallApps?.()} />
        ) : apk ? (
          <Button label="Install" onPress={() => install(apk)} />
        ) : (
          <Button label="Download and install" busy={sent !== null} onPress={download} />
        )}
      </Actions>
    </Frame>
  )
}
