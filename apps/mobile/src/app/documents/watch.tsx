import { useLocalSearchParams } from "expo-router"
import { CaretRight, Folder, FolderMinus, Plus, X } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { Group, Loaded, Page, Row } from "@/components/page"
import { Sheet, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Button, IconButton, Text } from "@/components/ui"
import { useDocActions, useDocWatch } from "@/lib/documents"
import { useFolders } from "@/lib/files"
import { c } from "@/lib/theme"

// Watched folders (everything counts) or, with ?ignore=1, Not watched (nothing counts unless marked by hand).
const LISTS = {
  watch: {
    title: "Watched folders",
    about: "Every file in a watched folder, and the folders inside it, is found as a document and waits in Needs review.",
    empty: "No folders are watched. Scans and uploads from Documents are always found.",
    remove: "Stop watching",
    removed: "No longer watched.",
    added: "Watching that folder.",
    action: "Watch this folder",
  },
  ignore: {
    title: "Not watched",
    about: "Nothing in these folders, or the folders inside them, is found as a document, not even PDFs. Files you mark by hand still count. Guesses waiting in Needs review leave when you add a folder.",
    empty: "No folders are skipped.",
    remove: "Watch again",
    removed: "Files there can be found again.",
    added: "Documents skips that folder.",
    action: "Skip this folder",
  },
}

export default function Watch() {
  const ignore = useLocalSearchParams<{ ignore?: string }>().ignore === "1"
  const t = LISTS[ignore ? "ignore" : "watch"]
  const q = useDocWatch()
  const actions = useDocActions()
  const snack = useSnack()
  const [adding, setAdding] = useState(false)
  const told = (err: string | void, text: string) => snack(err ? { text: err, error: true } : { text })
  return (
    <Page title={t.title} trailing={<Button variant="text" label="Add" icon={<Plus size={18} color={c.foreground} />} onPress={() => setAdding(true)} />}>
      <Text variant="bodySmall" color={c.mutedForeground}>{t.about}</Text>
      <Loaded query={q}>
        {(res) => {
          const folders = ignore ? res.ignored ?? [] : res.folders
          return folders.length ? (
            <Group>
              {folders.map((f) => (
                <Row
                  key={f.id}
                  label={f.name}
                  detail={f.path}
                  icon={ignore ? <FolderMinus size={24} color={c.mutedForeground} /> : <Folder size={24} color={c.file.folder} weight="fill" />}
                  trailing={<IconButton icon={X} label={`${t.remove} ${f.name}`} onPress={async () => told(await actions.unwatch(f.id), t.removed)} />}
                />
              ))}
            </Group>
          ) : (
            <Text color={c.mutedForeground}>{t.empty}</Text>
          )
        }}
      </Loaded>
      {adding && <PickFolder action={t.action} onClose={() => setAdding(false)} onPick={async (id) => told(await actions.watch(id, ignore), t.added)} />}
    </Page>
  )
}

// Walks down My files one folder at a time; the footer picks where you are.
function PickFolder({ action, onClose, onPick }: { action: string; onClose: () => void; onPick: (id: string) => void }) {
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([])
  const here = trail[trail.length - 1]
  const folders = useFolders(here?.id ?? null)
  return (
    <Sheet
      onClose={onClose}
      tall
      header={<Text variant="titleSmall" style={{ paddingHorizontal: 20, paddingBottom: 8 }} numberOfLines={1}>{here ? here.name : "My files"}</Text>}
      footer={
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <Button label={action} disabled={!here} onPress={() => { onPick(here!.id); onClose() }} />
        </View>
      }
    >
      {here && <SheetRow stay label="Up one level" onPress={() => setTrail(trail.slice(0, -1))} />}
      {(folders.data?.folders ?? []).map((f) => (
        <SheetRow key={f.id} stay label={f.name} icon={<Folder size={24} color={c.file.folder} weight="fill" />} trailing={<CaretRight size={16} color={c.mutedForeground} />} onPress={() => setTrail([...trail, f])} />
      ))}
      {folders.isError && <Text color={c.destructive} style={{ padding: 20 }}>{folders.error.message}</Text>}
      {folders.data && !folders.data.folders.length && <Text color={c.mutedForeground} style={{ padding: 20 }}>No folders in here.</Text>}
    </Sheet>
  )
}
