import { formatBytes } from "@nimbus/shared/file-rules"
import { View } from "react-native"

import { Group, Page, Section, SwitchRow } from "@/components/page"
import { Spinner, Text } from "@/components/ui"
import { useAlbums, useBackup } from "@/lib/backup"
import { c } from "@/lib/theme"

export default function Albums() {
  const albums = useAlbums()
  const { settings, change } = useBackup()
  const others = albums?.filter((a) => !a.camera) ?? []
  return (
    <Page title="Other albums">
      <Section note="Each album backs up to its own folder: Camera/Album name/year/month. The camera always backs up.">
        {!albums ? (
          <View style={{ height: 120 }}><Spinner /></View>
        ) : others.length === 0 ? (
          <Text color={c.mutedForeground}>No other albums on this phone.</Text>
        ) : (
          <Group>
            {others.map((a) => (
              <SwitchRow
                key={a.id}
                label={a.name}
                detail={`${a.count} item${a.count === 1 ? "" : "s"} · ${formatBytes(a.bytes)}`}
                value={settings.albums.includes(a.id)}
                onChange={(on) => change({ albums: on ? [...settings.albums, a.id] : settings.albums.filter((x) => x !== a.id) })}
              />
            ))}
          </Group>
        )}
      </Section>
    </Page>
  )
}
