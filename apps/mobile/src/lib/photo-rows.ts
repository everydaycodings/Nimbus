// The Photos grid as list rows: a header per month, then rows of `columns` tiles.
import type { PhotoItem } from "@nimbus/shared/api"
import { groupByMonth, monthTitle } from "@nimbus/shared/photos"

export type PhotoRow =
  | { type: "month"; key: string; month: string; title: string }
  | { type: "row"; key: string; month: string; items: PhotoItem[]; start: number }

export function photoRows(items: PhotoItem[], columns: number, now = new Date()): PhotoRow[] {
  const rows: PhotoRow[] = []
  let start = 0
  for (const g of groupByMonth(items)) {
    rows.push({ type: "month", key: `m${start}`, month: g.key, title: monthTitle(g.key, now) })
    for (let i = 0; i < g.items.length; i += columns) {
      rows.push({ type: "row", key: g.items[i].id, month: g.key, items: g.items.slice(i, i + columns), start: start + i })
    }
    start += g.items.length
  }
  return rows
}
