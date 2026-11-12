import type { MemoryHide } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { CalendarBlank, FolderSimple, Image } from "phosphor-react-native"

import { Group, Loaded, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { useHides } from "@/lib/photos"
import { c } from "@/lib/theme"

const dayName = (day: string | null) => {
  const [m, d] = (day ?? "").split("-").map(Number)
  return m && d ? new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "A day"
}

const describe = (h: MemoryHide) =>
  h.kind === "day" ? { title: dayName(h.day), kind: "Day", icon: CalendarBlank } : h.kind === "folder" ? { title: h.name ?? "A folder that's gone", kind: "Folder", icon: FolderSimple } : { title: h.name ?? "A photo that's gone", kind: "Photo", icon: Image }

// Everything kept out of On this day, each with a way back.
export default function Hidden() {
  const api = useApi()
  const hides = useHides()
  const client = useQueryClient()
  const snack = useSnack()

  const show = async (h: MemoryHide) => {
    try {
      await api.del(`/photos/hides/${h.id}`)
      await Promise.all([client.invalidateQueries({ queryKey: [api.id, "memory-hides"] }), client.invalidateQueries({ queryKey: [api.id, "memories"] })])
      snack({ text: "It can show up in memories again." })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <Page title="Hidden from memories">
      <Loaded query={hides}>
        {(d) =>
          d.hides.length ? (
            <Group>
              {d.hides.map((h) => {
                const x = describe(h)
                return (
                  <Row
                    key={h.id}
                    label={x.title}
                    detail={x.kind}
                    icon={<x.icon size={24} color={c.mutedForeground} />}
                    trailing={<Button variant="text" label="Show again" onPress={() => show(h)} />}
                  />
                )
              })}
            </Group>
          ) : (
            <Text color={c.mutedForeground}>Nothing is hidden. Long press an On this day card, or use the hide button while a memory plays, to keep a photo, a day or a folder out.</Text>
          )
        }
      </Loaded>
    </Page>
  )
}
