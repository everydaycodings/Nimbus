import { CSV_MAX, PREVIEW_ROWS as ROWS } from "@nimbus/shared/file-rules"
import * as XLSX from "xlsx"

import { parseCsv } from "../../web/lib/csv"
import { el, meta, read, run } from "./core"

function table(rows: string[][]) {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const t = el("table")
  rows.forEach((r, i) => {
    const tr = el("tr")
    tr.append(el(i ? "td" : "th", "num", i ? String(i + 1) : ""))
    for (let j = 0; j < width; j++) tr.append(el(i ? "td" : "th", undefined, r[j] ?? ""))
    t.append(tr)
  })
  return t
}

const cutNote = () => el("div", "note", `Showing the first ${ROWS.toLocaleString()} rows.`)

run(async () => {
  document.body.classList.add("sheet")
  if (/\.(csv|tsv)$/i.test(meta.name)) {
    const bytes = await read(0, Math.min(meta.size, CSV_MAX))
    const rows = parseCsv(new TextDecoder().decode(bytes), /\.tsv$/i.test(meta.name) ? "\t" : ",", ROWS + 2)
    document.body.append(table(rows.slice(0, ROWS + 1)))
    if (rows.length > ROWS + 1 || meta.size > CSV_MAX) document.body.append(cutNote())
    return
  }
  const book = XLSX.read(await read(0, meta.size), { sheetRows: ROWS + 1 })
  const sheets = book.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1, raw: false, defval: "" }),
  }))
  const body = el("div")
  document.body.append(body)
  const show = (i: number) => {
    body.replaceChildren(table(sheets[i].rows))
    if (sheets[i].rows.length > ROWS) body.append(cutNote())
    window.scrollTo(0, 0)
  }
  show(0)
  if (sheets.length < 2) return
  const tabs = el("div", "tabs")
  sheets.forEach((s, i) => {
    const b = el("button", undefined, s.name)
    b.setAttribute("aria-pressed", String(!i))
    b.onclick = () => {
      for (const o of tabs.children) o.setAttribute("aria-pressed", String(o === b))
      show(i)
    }
    tabs.append(b)
  })
  document.body.append(tabs)
}, "Couldn't read this spreadsheet. It may be damaged.")
