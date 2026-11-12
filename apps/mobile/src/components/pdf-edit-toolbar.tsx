// The PDF editor's bottom bar: tools, then what the chosen tool needs (colour, width, a hint, Delete).
import {
  ArrowUpRight,
  CircleIcon as Circle,
  Cursor,
  Eraser,
  Highlighter,
  LineSegment,
  Note,
  PencilSimpleLine,
  Rectangle,
  Signature,
  TextStrikethrough,
  TextT,
  TextUnderline,
  Trash,
} from "phosphor-react-native"
import type { ComponentType } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button, Text } from "@/components/ui"
import { COLORS, TOOLS, needsColor, needsWidth, type EditorState, type Tool } from "@/lib/pdf-edit-rules"
import { c, radius } from "@/lib/theme"

type Icon = ComponentType<{ size?: number; color?: string; weight?: "regular" | "bold" | "fill" }>
const ICONS: Record<string, Icon> = {
  select: Cursor,
  highlight: Highlighter,
  underline: TextUnderline,
  strike: TextStrikethrough,
  note: Note,
  text: TextT,
  pen: PencilSimpleLine,
  rect: Rectangle,
  ellipse: Circle,
  line: LineSegment,
  arrow: ArrowUpRight,
  eraser: Eraser,
}
// Presets stand in for the web's slider: thin, medium, thick, heavy (points; free text uses four times as its font size).
const STROKES = [1.5, 3, 5, 8]
const TEXT_SIZES = [2, 3, 4, 6]

function Tile({ label, selected, onPress, children }: { label: string; selected?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.control, overflow: "hidden", backgroundColor: selected ? c.mutedStrong : "transparent" }}>
      <Pressable
        onPress={onPress}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!selected }}
        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
      >
        {children}
      </Pressable>
    </View>
  )
}

export function PdfEditToolbar({
  state,
  color,
  width,
  onTool,
  onColor,
  onWidth,
  onSign,
  onDelete,
}: {
  state: EditorState | null
  color: string
  width: number
  onTool: (t: Tool) => void
  onColor: (hex: string) => void
  onWidth: (w: number) => void
  onSign: () => void
  onDelete: () => void
}) {
  const inset = useSafeAreaInsets()
  const ready = !!state
  const tool = state?.tool ?? "select"
  const widths = tool === "text" ? TEXT_SIZES : STROKES
  return (
    <View style={{ backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.border, paddingBottom: inset.bottom, opacity: ready ? 1 : 0.5 }} pointerEvents={ready ? "auto" : "none"}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 4 }} accessibilityRole="toolbar" accessibilityLabel="Tools">
        {TOOLS.map(({ tool: t, label }) => {
          const I = ICONS[t]
          return (
            <Tile key={t} label={label} selected={tool === t} onPress={() => onTool(t)}>
              <I size={24} color={tool === t ? c.foreground : c.mutedForeground} weight={tool === t ? "bold" : "regular"} />
            </Tile>
          )
        })}
        <Tile label="Sign" selected={tool === "stamp"} onPress={onSign}>
          <Signature size={24} color={tool === "stamp" ? c.foreground : c.mutedForeground} weight={tool === "stamp" ? "bold" : "regular"} />
        </Tile>
      </ScrollView>

      <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: c.border }}>
        {state?.selected ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
            <Button variant="text" danger label="Delete" icon={<Trash size={20} color={c.destructive} />} onPress={onDelete} />
          </View>
        ) : needsColor(tool) || needsWidth(tool) ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ alignItems: "center", gap: 8 }}>
            {needsColor(tool) && (
              <View style={{ flexDirection: "row", alignItems: "center" }} accessibilityRole="radiogroup" accessibilityLabel="Colour">
                {COLORS.map((k) => (
                  <Pressable
                    key={k.hex}
                    accessibilityRole="radio"
                    accessibilityLabel={k.label}
                    accessibilityState={{ checked: color === k.hex }}
                    onPress={() => onColor(k.hex)}
                    style={{ width: 44, height: 48, alignItems: "center", justifyContent: "center" }}
                  >
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: k.hex, borderWidth: color === k.hex ? 2 : 1, borderColor: color === k.hex ? c.brand : c.input }} />
                  </Pressable>
                ))}
              </View>
            )}
            {needsWidth(tool) && (
              <View style={{ flexDirection: "row", alignItems: "center", marginLeft: needsColor(tool) ? 8 : 0 }} accessibilityRole="radiogroup" accessibilityLabel={tool === "text" ? "Text size" : "Stroke width"}>
                <Text variant="caption" color={c.mutedForeground} style={{ marginRight: 4 }}>{tool === "text" ? "Size" : "Width"}</Text>
                {widths.map((w, i) => (
                  <Tile key={w} label={tool === "text" ? `Text size ${i + 1}` : `Stroke width ${i + 1}`} selected={width === w} onPress={() => onWidth(w)}>
                    {tool === "text" ? (
                      <Text variant="label" color={c.foreground} style={{ fontSize: 11 + i * 3 }}>A</Text>
                    ) : (
                      <View style={{ width: 24, height: w + 1, borderRadius: w, backgroundColor: c.foreground }} />
                    )}
                  </Tile>
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <Text variant="bodySmall" color={c.mutedForeground} style={{ paddingHorizontal: 12 }}>
            {tool === "stamp" ? "Tap the page where it goes." : tool === "select" ? "Fill in fields, or tap a mark to move it." : hint(tool)}
          </Text>
        )}
      </View>
    </View>
  )
}

const hint = (t: Tool) => (t === "note" ? "Tap the page to add a note." : t === "eraser" ? "Drag over a mark to erase it." : "")
