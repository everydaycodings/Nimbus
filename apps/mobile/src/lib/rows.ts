import type { Item } from "@nimbus/shared/api"

import { systemFirst } from "./system-folders.ts"

export type Tiles = "small" | "medium" | "large"
export type Layout = "grid" | "list"

export type Row =
  | { key: string; type: "header"; title: string }
  | { key: string; type: "folders" | "files"; items: Item[] }
  | { key: string; type: "item"; item: Item }

// Smallest tile width in dp, per size: gives 3, 2 and 1 columns on a phone,
// and more on a tablet.
const TILE = { small: 96, medium: 156, large: 300 }

export const columnsFor = (width: number, tiles: Tiles, gap = 12, gutter = 16) =>
  Math.max(1, Math.floor((width - gutter * 2 + gap) / (TILE[tiles] + gap)))

function chunk(type: "folders" | "files", items: Item[], columns: number): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < items.length; i += columns) {
    const part = items.slice(i, i + columns)
    rows.push({ key: `${type}-${part[0].id}`, type, items: part })
  }
  return rows
}

// The list's rows. A grid splits into titled Folders and Files sections, chunked
// to the column count, with folders first whatever the sort. A list stays in the
// server's order. `pinSystem` (My files) puts system folders ahead of the rest in both.
export function toRows(items: Item[], columns: number, layout: Layout, pinSystem = false): Row[] {
  if (pinSystem) items = systemFirst(items)
  if (layout === "list") return items.map((item) => ({ key: item.id, type: "item", item }))
  const folders = items.filter((i) => i.kind === "folder")
  const files = items.filter((i) => i.kind === "file")
  return [
    ...(folders.length
      ? [{ key: "h-folders", type: "header", title: "Folders" } as Row, ...chunk("folders", folders, columns)]
      : []),
    ...(files.length
      ? [{ key: "h-files", type: "header", title: "Files" } as Row, ...chunk("files", files, columns)]
      : []),
  ]
}
