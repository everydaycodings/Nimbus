import * as Clipboard from "expo-clipboard"
import Constants from "expo-constants"
import { router } from "expo-router"
import { ArrowSquareOut, Copy, GithubLogo, Scales } from "phosphor-react-native"
import { Linking, View } from "react-native"

import { BrandMark } from "@/components/brand"
import { Caret, Group, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { pendingCrash } from "@/lib/crash"
import { useReport } from "@/lib/report"
import { c } from "@/lib/theme"

const SOURCE = "https://github.com/everydaycodings/Nimbus"

const version = Constants.expoConfig?.version ?? "?"
const build = String(Constants.expoConfig?.android?.versionCode ?? "?")

export default function About() {
  const snack = useSnack()
  const report = useReport()
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
        <Row label="Source code" detail="github.com/everydaycodings/Nimbus" icon={<GithubLogo size={24} color={c.mutedForeground} />} trailing={<ArrowSquareOut size={20} color={c.mutedForeground} />} onPress={() => Linking.openURL(SOURCE)} />
        <Row label="Copy diagnostics" detail="For bug reports: versions, settings and recent errors" icon={<Copy size={24} color={c.mutedForeground} />} onPress={copy} />
        <Row label="Open-source licences" detail="What Nimbus is built on" icon={<Scales size={24} color={c.mutedForeground} />} trailing={<Caret />} onPress={() => router.push("/licences")} />
      </Group>
    </Page>
  )
}
