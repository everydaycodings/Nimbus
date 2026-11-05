import { router } from "expo-router"
import { ArrowLeft, DotsThreeVertical, PencilSimple, Plus, Trash } from "phosphor-react-native"
import { useState } from "react"
import { FlatList, Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ConfirmDialog } from "@/components/dialog"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { TagDialog } from "@/components/tag-dialog"
import { Bar, Button, Fab, IconButton, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useFileActions, useTags } from "@/lib/files"
import { c } from "@/lib/theme"
import type { Tag } from "@nimbus/shared/api"

const items = (n: number) => `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`

type Open =
  | { kind: "menu"; tag: Tag }
  | { kind: "edit"; tag?: Tag }
  | { kind: "merge"; tag: Tag; into: Tag }
  | { kind: "delete"; tag: Tag; uses: number }

export default function Tags() {
  const inset = useSafeAreaInsets()
  const tags = useTags()
  const actions = useFileActions()
  const snack = useSnack()
  const [open, setOpen] = useState<Open | null>(null)
  const close = () => setOpen(null)

  const askDelete = async (tag: Tag) => {
    try {
      setOpen({ kind: "delete", tag, uses: await actions.tagCount(tag.id) })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" accessibilityRole="header">Tags</Text>
      </Bar>

      {tags.isPending ? (
        <Spinner />
      ) : tags.error && !tags.data ? (
        <View style={{ padding: 24, gap: 12, alignItems: "flex-start" }}>
          <Text color={c.mutedForeground}>{tags.error.message}</Text>
          <Button variant="outlined" label="Try again" busy={tags.isFetching} onPress={() => tags.refetch()} />
        </View>
      ) : (
        <FlatList
          data={tags.data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingBottom: inset.bottom + 96, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ padding: 24, gap: 4 }}>
              <Text variant="titleSmall">No tags yet</Text>
              <Text color={c.mutedForeground}>Tags you make show up as filters in your files.</Text>
            </View>
          }
          renderItem={({ item: t }) => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Tag ${t.name}`}
                android_ripple={{ color: c.ripple }}
                onPress={() => router.push(`/tag/${t.id}`)}
                style={{ flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: 20 }}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.tag[t.color] }} />
                <Text style={{ flex: 1 }} numberOfLines={1}>{t.name}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`More for ${t.name}`}
                android_ripple={{ color: c.ripple, radius: 24 }}
                onPress={() => setOpen({ kind: "menu", tag: t })}
                style={{ width: 48, height: 48, marginRight: 4, alignItems: "center", justifyContent: "center" }}
              >
                <DotsThreeVertical size={24} weight="bold" color={c.mutedForeground} />
              </Pressable>
            </View>
          )}
        />
      )}

      <Fab label="New tag" icon={<Plus size={24} color={c.primaryForeground} />} style={{ bottom: inset.bottom + 16 }} onPress={() => setOpen({ kind: "edit" })} />

      {open?.kind === "menu" && (
        <Sheet onClose={close}>
          <SheetRow
            label="Rename or change colour"
            icon={<PencilSimple size={24} color={c.foreground} />}
            onPress={() => setOpen({ kind: "edit", tag: open.tag })}
          />
          <SheetDivider />
          <SheetRow label="Delete" danger icon={<Trash size={24} color={c.destructive} />} onPress={() => askDelete(open.tag)} />
        </Sheet>
      )}
      {open?.kind === "edit" && (
        <TagDialog
          tag={open.tag}
          onClose={close}
          onMerge={(id) => {
            const into = tags.data?.find((t) => t.id === id)
            const tag = open.tag
            // Closing the dialog follows this, so the confirm is set after it.
            if (tag && into) setTimeout(() => setOpen({ kind: "merge", tag, into }), 0)
          }}
        />
      )}
      {open?.kind === "merge" && (
        <ConfirmDialog
          title={`Merge “${open.tag.name}” into “${open.into.name}”?`}
          body={`You already have a tag called “${open.into.name}”. Everything tagged “${open.tag.name}” gets it instead, and “${open.tag.name}” is removed.`}
          confirm="Merge tags"
          danger={false}
          onClose={close}
          onConfirm={() => actions.mergeTag(open.tag, open.into)}
        />
      )}
      {open?.kind === "delete" && (
        <ConfirmDialog
          title={open.uses ? `Remove “${open.tag.name}” from ${items(open.uses)}?` : `Delete “${open.tag.name}”?`}
          body="The tag is deleted. The items themselves stay where they are."
          confirm="Delete tag"
          onClose={close}
          onConfirm={() => actions.deleteTag(open.tag)}
        />
      )}
    </View>
  )
}
