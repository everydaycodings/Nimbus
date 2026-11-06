import * as Clipboard from "expo-clipboard"
import { Component, useEffect, useState, type ReactNode } from "react"
import { View } from "react-native"

import { BrandMark } from "./brand"
import { Actions, Frame } from "./dialog"
import { useSnack } from "./snackbar"
import { Button, Text } from "./ui"
import { clearCrash, pendingCrash, recordCrash, type Crash } from "@/lib/crash"
import { reportWithoutAccounts, useReport } from "@/lib/report"
import { c } from "@/lib/theme"

// Catches what the screens' own boundaries don't, above every provider, so it can't depend on any of them.
export class CrashBoundary extends Component<{ children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    recordCrash(error)
  }
  render() {
    if (!this.state.error) return <Remount key={this.state.attempt}>{this.props.children}</Remount>
    return <Fallback onRestart={() => {
      clearCrash() // recovered, so the next launch has nothing to apologise for
      this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))
    }} />
  }
}
const Remount = ({ children }: { children: ReactNode }) => <>{children}</>

function Fallback({ onRestart }: { onRestart: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <View style={{ flex: 1, backgroundColor: c.background, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
      <BrandMark />
      <View style={{ gap: 8, alignItems: "center" }}>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>Something went wrong</Text>
        <Text color={c.mutedForeground} style={{ textAlign: "center" }}>Nimbus hit a problem it couldn't recover from. Your files are safe. Restart to carry on.</Text>
      </View>
      <View style={{ gap: 12, alignSelf: "stretch" }}>
        <Button label="Restart" onPress={onRestart} />
        <Button
          variant="outlined"
          label={copied ? "Copied" : "Copy report"}
          onPress={async () => {
            await Clipboard.setStringAsync(reportWithoutAccounts(pendingCrash()))
            setCopied(true)
          }}
        />
      </View>
    </View>
  )
}

// After a crash, once: offers the report that explains it. Dismissing (or copying) forgets it.
export function CrashPrompt() {
  const [crash, setCrash] = useState<Crash | null>(null)
  const report = useReport()
  const snack = useSnack()
  useEffect(() => setCrash(pendingCrash()), [])
  if (!crash) return null
  const done = () => {
    clearCrash()
    setCrash(null)
  }
  return (
    <Frame title="Nimbus closed unexpectedly" onClose={done}>
      <Text color={c.mutedForeground}>A report of what happened is ready to paste into a bug report. It stays on this phone until you copy it, and server addresses and emails are shortened.</Text>
      <Actions>
        <Button variant="text" label="Dismiss" onPress={done} />
        <Button
          variant="text"
          label="Copy report"
          onPress={async () => {
            await Clipboard.setStringAsync(report(crash))
            snack({ text: "Copied. Server addresses and emails are shortened." })
            done()
          }}
        />
      </Actions>
    </Frame>
  )
}
