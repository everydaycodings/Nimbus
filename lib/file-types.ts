import {
  FileAudioIcon,
  FileCodeIcon,
  FileDocIcon,
  FileIcon,
  FileImageIcon,
  FilePdfIcon,
  FileVideoIcon,
  FileZipIcon,
  FolderIcon,
} from "@phosphor-icons/react"

import { AUDIO, DOC, IMAGE, VIDEO, mimeOf } from "@/lib/file-rules"

export { DOC, formatBytes } from "@/lib/file-rules"

// Icon and hue for each kind of file. Colors are the --file-* tokens in globals.css.
const TYPES = {
  folder: {
    key: "folder",
    label: "Folders",
    icon: FolderIcon,
    color: "text-file-folder",
  },
  image: {
    key: "image",
    label: "Images",
    icon: FileImageIcon,
    color: "text-file-image",
  },
  video: {
    key: "video",
    label: "Videos",
    icon: FileVideoIcon,
    color: "text-file-video",
  },
  doc: {
    key: "doc",
    label: "Documents",
    icon: FileDocIcon,
    color: "text-file-doc",
  },
  pdf: { key: "pdf", label: "PDFs", icon: FilePdfIcon, color: "text-file-pdf" },
  audio: {
    key: "audio",
    label: "Audio",
    icon: FileAudioIcon,
    color: "text-file-audio",
  },
  code: {
    key: "code",
    label: "Code",
    icon: FileCodeIcon,
    color: "text-file-code",
  },
  archive: {
    key: "archive",
    label: "Archives",
    icon: FileZipIcon,
    color: "text-file-archive",
  },
  other: {
    key: "other",
    label: "Other",
    icon: FileIcon,
    color: "text-muted-foreground",
  },
}

const CODE =
  /\.(c|cpp|cs|css|go|h|html|java|js|json|jsx|kt|md|php|py|rb|rs|sh|sql|swift|toml|ts|tsx|xml|ya?ml)$/i
const ARCHIVE = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i

export function fileType(
  kind: "file" | "folder",
  mime: string | null,
  name: string
) {
  if (kind === "folder") return TYPES.folder
  // Known extensions first, the stored mime type only for the rest (as getUsage).
  if (IMAGE.test(name)) return TYPES.image
  if (VIDEO.test(name)) return TYPES.video
  if (AUDIO.test(name)) return TYPES.audio
  if (/\.pdf$/i.test(name)) return TYPES.pdf
  if (CODE.test(name)) return TYPES.code
  if (ARCHIVE.test(name)) return TYPES.archive
  if (DOC.test(name)) return TYPES.doc
  const m = mimeOf(mime, name)
  if (m.startsWith("image/")) return TYPES.image
  if (m.startsWith("video/")) return TYPES.video
  if (m.startsWith("audio/")) return TYPES.audio
  if (m === "application/pdf") return TYPES.pdf
  if (m.startsWith("text/")) return TYPES.doc
  return TYPES.other
}

export const TAG_DOT = {
  red: "bg-tag-red",
  orange: "bg-tag-orange",
  yellow: "bg-tag-yellow",
  green: "bg-tag-green",
  blue: "bg-tag-blue",
  purple: "bg-tag-purple",
  pink: "bg-tag-pink",
  teal: "bg-tag-teal",
  indigo: "bg-tag-indigo",
  brown: "bg-tag-brown",
  gray: "bg-tag-gray",
}
