// A PowerPoint file's outline: per slide, the title, the other text and the
// pictures. No app imports or DOM: the previewer, thumbnails and the Node
// indexer share it. ponytail: regexes over the XML, no layout; enough for an
// outline, not a rendering.

import { unzip, type ZipEntry } from "unzipit"

export type Slide = {
  title: string
  paragraphs: string[]
  images: { name: string; mime: string; blob: () => Promise<Blob> }[]
}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}
const unxml = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10)
        )
      : (ENTITY[e] ?? m)
  )

// Images browsers can show; EMF/WMF are skipped.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
}

const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ""

// Relationship id → target path, resolved against the part's folder.
function rels(xml: string, dir: string) {
  const out = new Map<string, { type: string; path: string }>()
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const parts = `${dir}/${attr(tag, "Target")}`.split("/")
    const path: string[] = []
    for (const p of parts)
      if (p === "..") path.pop()
      else if (p && p !== ".") path.push(p)
    out.set(attr(tag, "Id"), { type: attr(tag, "Type"), path: path.join("/") })
  }
  return out
}

// Each <a:p>'s runs joined, empty ones dropped.
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map(([p]) =>
      unxml(
        [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")
      ).trim()
    )
    .filter(Boolean)

export async function readPptx(
  file: Uint8Array | ArrayBuffer | Blob
): Promise<Slide[]> {
  const { entries } = await unzip(file)
  const read = (n: string) => entries[n]?.text() ?? Promise.resolve("")
  const pres = await read("ppt/presentation.xml")
  const presRels = rels(await read("ppt/_rels/presentation.xml.rels"), "ppt")
  const order = [...pres.matchAll(/<p:sldId\b[^>]*>/g)]
    .map(([tag]) => presRels.get(attr(tag, "r:id"))?.path)
    .filter((p): p is string => Boolean(p && entries[p]))

  return Promise.all(
    order.map(async (path) => {
      const xml = await read(path)
      const [dir, file] = [path.replace(/\/[^/]+$/, ""), path.split("/").pop()]
      const slideRels = rels(await read(`${dir}/_rels/${file}.rels`), dir)
      let title = ""
      // Title placeholders out, so the rest are the other paragraphs.
      const body = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (sp) => {
        if (!/<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp)) return sp
        title ||= paragraphs(sp).join(" ")
        return ""
      })
      const seen = new Set<string>()
      const images: Slide["images"] = []
      for (const [, id] of body.matchAll(/r:embed="([^"]*)"/g)) {
        const rel = slideRels.get(id)
        const mime = MIME[rel?.path.split(".").pop()?.toLowerCase() ?? ""]
        const entry: ZipEntry | undefined = rel && entries[rel.path]
        if (!rel || !mime || !entry || seen.has(rel.path)) continue
        seen.add(rel.path)
        images.push({
          name: rel.path.split("/").pop()!,
          mime,
          blob: () => entry.blob(mime),
        })
      }
      return { title, paragraphs: paragraphs(body), images }
    })
  )
}
