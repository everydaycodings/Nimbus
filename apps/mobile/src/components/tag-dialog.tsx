import { useState } from "react"
import { Pressable, View } from "react-native"

import { PromptDialog } from "@/components/dialog"
import { useFileActions } from "@/lib/files"
import { c } from "@/lib/theme"
import type { Tag, TagColor } from "@nimbus/shared/api"

const COLORS = Object.keys(c.tag) as TagColor[]

// New tag (optionally applied to `applyTo`) or edit one. A name that already
// exists comes back as a merge, which the caller confirms through onMerge.
export function TagDialog({
  tag,
  applyTo,
  onClose,
  onMerge,
}: {
  tag?: Tag
  applyTo?: string[]
  onClose: () => void
  onMerge?: (into: string) => void
}) {
  const actions = useFileActions()
  const [color, setColor] = useState<TagColor>(tag?.color ?? "blue")
  return (
    <PromptDialog
      title={tag ? "Edit tag" : "New tag"}
      label="Name"
      initial={tag?.name}
      confirm={tag ? "Save" : "Create"}
      onClose={onClose}
      onSubmit={async (name) => {
        if (!tag) return actions.createTag(name, color, applyTo)
        const res = await actions.updateTag(tag, name, color)
        if (res.merge) onMerge?.(res.merge)
        return res.error
      }}
    >
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -8 }}>
        {COLORS.map((name) => {
          const selected = name === color
          return (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityLabel={name}
              accessibilityState={{ selected }}
              onPress={() => setColor(name)}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <View
                style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: selected ? c.foreground : "transparent" }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.tag[name] }} />
              </View>
            </Pressable>
          )
        })}
      </View>
    </PromptDialog>
  )
}
