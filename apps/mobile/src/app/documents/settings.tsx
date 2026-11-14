import { router } from "expo-router"
import { Folder, FolderMinus, Tag, UserCircle } from "phosphor-react-native"

import { Caret, Group, Page, Row } from "@/components/page"
import { Text } from "@/components/ui"
import { c } from "@/lib/theme"

export default function DocumentSettings() {
  const icon = (I: typeof Tag) => <I size={24} color={c.mutedForeground} />
  return (
    <Page title="Document settings">
      <Group>
        <Row label="Types" detail="Names and how early to remind" icon={icon(Tag)} trailing={<Caret />} onPress={() => router.push("/documents/types")} />
        <Row label="Senders" detail="Rename, merge or remove" icon={icon(UserCircle)} trailing={<Caret />} onPress={() => router.push("/documents/senders")} />
        <Row label="Watched folders" detail="Everything in them counts as a document" icon={icon(Folder)} trailing={<Caret />} onPress={() => router.push("/documents/watch")} />
        <Row label="Not watched" detail="Nothing in them counts, unless you mark it" icon={icon(FolderMinus)} trailing={<Caret />} onPress={() => router.push("/documents/watch?ignore=1")} />
      </Group>
      <Text variant="bodySmall" color={c.mutedForeground}>Reminders arrive as notifications before a document expires or falls due.</Text>
    </Page>
  )
}
