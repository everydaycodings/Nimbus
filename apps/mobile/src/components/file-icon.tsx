import type { Item, SystemKind } from "@nimbus/shared/api"
import { typeKeyOf, type TypeKey } from "@nimbus/shared/file-rules"
import {
  Camera,
  DeviceMobile,
  File,
  FileAudio,
  FileCode,
  FileDoc,
  FileText,
  FileImage,
  FilePdf,
  FilePpt,
  FileTxt,
  FileXls,
  FileVideo,
  FileZip,
  Folder,
  UsersThree,
} from "phosphor-react-native"

import { c } from "@/lib/theme"
import type { WithSystem } from "@/lib/system-folders"

const SYSTEM_ICON: Record<SystemKind, typeof File> = { camera: Camera, phone_backup: DeviceMobile, partner: UsersThree, documents: FileText }

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
  item: Pick<Item, "kind" | "mime" | "name"> & WithSystem
  size?: number
}) {
  if (item.system) {
    const Sys = SYSTEM_ICON[item.system]
    return <Sys size={size} color={c.brand} weight="fill" />
  }
  const key = typeKeyOf(item.kind, item.mime, item.name)
  const t = FILE_TYPES[key]
  const ext = item.name.split(".").pop()?.toLowerCase() ?? ""
  const Glyph = key !== "doc" ? t.icon : /^(xlsx?|ods|csv)$/.test(ext) ? FileXls : /^(pptx?|odp)$/.test(ext) ? FilePpt : ext === "txt" ? FileTxt : t.icon
  return <Glyph size={size} color={t.color} weight={item.kind === "folder" ? "fill" : "regular"} />
}
