import type { Item, MemoryYear } from "@nimbus/shared/api"
import { typeKeyOf } from "@nimbus/shared/file-rules"

// What the slideshow steps through: photos, and for memories a title card before each year's.
export type Slide = { kind: "card"; year: number; title: string; caption: string } | { kind: "photo"; item: Item }

export const isImage = (i: Item) => i.kind === "file" && typeKeyOf("file", i.mime, i.name) === "image"

export const photoSlides = (items: Item[]): Slide[] => items.filter(isImage).map((item) => ({ kind: "photo", item }))

export const yearsAgo = (n: number) => (n === 1 ? "1 year ago" : `${n} years ago`)

// Videos stay out (the slideshow shows stills), and so does a year left with nothing.
export function memorySlides(years: MemoryYear[]): Slide[] {
  return years.flatMap((y) => {
    const photos = y.items.filter(isImage)
    if (!photos.length) return []
    const caption = `${y.year} · ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`
    return [{ kind: "card" as const, year: y.year, title: yearsAgo(y.yearsAgo), caption }, ...photos.map((item) => ({ kind: "photo" as const, item }))]
  })
}
