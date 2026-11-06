import { useEffect, useMemo, useState } from "react"
import { BackHandler, View } from "react-native"

import { Caret, Group, Page, Row } from "@/components/page"
import { Field, Text } from "@/components/ui"
import { filterLicences, loadLicences, type LicencePackage } from "@/lib/licences"
import { c } from "@/lib/theme"

const SHOWN = 80

export default function Licences() {
  const data = useMemo(loadLicences, [])
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<LicencePackage | null>(null)
  const [all, setAll] = useState(false)
  const found = useMemo(() => filterLicences(data.packages, query), [data, query])
  // Back from a licence's text returns to the list, not out of the screen.
  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (setOpen(null), true))
    return () => sub.remove()
  }, [open])

  if (open) {
    const text = open.text >= 0 ? data.texts[open.text] : `No licence file came with this package. It is licensed under ${open.license}.`
    return (
      <Page title={open.name} caption={`${open.version} · ${open.license}`} onBack={() => setOpen(null)}>
        <Text variant="bodySmall" selectable style={{ fontFamily: "GeistMono_400Regular" }}>{text}</Text>
      </Page>
    )
  }
  const rows = all || query ? found : found.slice(0, SHOWN)
  return (
    <Page title="Open-source licences" caption={`${data.packages.length} packages`}>
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name or licence" autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      {rows.length ? (
        <Group>
          {rows.map((p) => (
            <Row key={`${p.name}@${p.version}`} label={p.name} detail={p.version} trailing={<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text variant="bodySmall" color={c.mutedForeground}>{p.license}</Text><Caret /></View>} onPress={() => setOpen(p)} />
          ))}
        </Group>
      ) : (
        <Text variant="bodySmall" color={c.mutedForeground}>Nothing matches.</Text>
      )}
      {!all && !query && found.length > SHOWN && (
        <Group>
          <Row label={`Show all ${found.length}`} onPress={() => setAll(true)} />
        </Group>
      )}
    </Page>
  )
}
