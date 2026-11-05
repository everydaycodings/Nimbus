import { unzipRaw } from "unzipit"
import { formatBytes } from "@nimbus/shared/file-rules"

import { el, meta, read, run } from "./core"

const MAX = 5000

run(async () => {
  const { entries } = await unzipRaw({
    getLength: async () => meta.size,
    read: async (offset: number, n: number) => (await read(offset, n)) as Uint8Array<ArrayBuffer>,
  })
  const files = entries
    .filter((e) => !e.isDirectory)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const total = files.reduce((n, f) => n + f.size, 0)
  const list = el("ul", "entries")
  for (const f of files.slice(0, MAX)) {
    const li = el("li")
    const name = el("div", "name")
    const slash = f.name.lastIndexOf("/")
    if (slash > 0) name.append(el("span", "dir", f.name.slice(0, slash + 1)))
    name.append(f.name.slice(slash + 1))
    li.append(name, el("div", "size", formatBytes(f.size)))
    list.append(li)
  }
  document.body.append(el("div", "summary", `${files.length.toLocaleString()} ${files.length === 1 ? "file" : "files"} · ${formatBytes(total)} unzipped`), list)
  if (files.length > MAX) document.body.append(el("div", "note", `Showing the first ${MAX.toLocaleString()} files.`))
}, "Couldn't read this zip file. It may be damaged.")
