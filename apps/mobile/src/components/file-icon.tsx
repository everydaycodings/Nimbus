import type { Item } from "@nimbus/shared/api"
import { typeKeyOf, type TypeKey } from "@nimbus/shared/file-rules"
import {
  File,
  FileAudio,
  FileCode,
  FileDoc,
  FileImage,
  FilePdf,
  FilePpt,
  FileTxt,
  FileXls,
  FileVideo,
  FileZip,
  Folder,
} from "phosphor-react-native"

import { c } from "@/lib/theme"

// The web's fileType(): same icons and hues, so a file looks the same on both.
export const FILE_TYPES: Record<TypeKey, { label: string; icon: typeof File; color: string }> = {
  folder: { label: "Folders", icon: Folder, color: c.file.folder },
  image: { label: "Images", icon: FileImage, color: c.file.image },
  video: { label: "Videos", icon: FileVideo, color: c.file.video },
  doc: { label: "Documents", icon: FileDoc, color: c.file.doc },
  pdf: { label: "PDFs", icon: FilePdf, color: c.file.pdf },
  audio: { label: "Audio", icon: FileAudio, color: c.file.audio },
  code: { label: "Code", icon: FileCode, color: c.file.code },
  archive: { label: "Archives", icon: FileZip, color: c.file.archive },
  other: { label: "Other", icon: File, color: c.file.other },
}

export function FileIcon({
  item,
  size = 24,
}: {
  item: Pick<Item, "kind" | "mime" | "name">
  size?: number
}) {
  const key = typeKeyOf(item.kind, item.mime, item.name)
  const t = FILE_TYPES[key]
  const ext = item.name.split(".").pop()?.toLowerCase() ?? ""
  const Glyph = key !== "doc" ? t.icon : /^(xlsx?|ods|csv)$/.test(ext) ? FileXls : /^(pptx?|odp)$/.test(ext) ? FilePpt : ext === "txt" ? FileTxt : t.icon
  return <Glyph size={size} color={t.color} weight={item.kind === "folder" ? "fill" : "regular"} />
}
