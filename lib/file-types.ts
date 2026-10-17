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
const DOC = /\.(docx?|odt|rtf|txt|xlsx?|ods|csv|pptx?|odp|pages|numbers|key)$/i
const ARCHIVE = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i

export function fileType(
  kind: "file" | "folder",
  mime: string | null,
  name: string
) {
  if (kind === "folder") return TYPES.folder
  const m = mime ?? ""
  if (m.startsWith("image/")) return TYPES.image
  if (m.startsWith("video/")) return TYPES.video
  if (m.startsWith("audio/")) return TYPES.audio
  if (m === "application/pdf") return TYPES.pdf
  if (CODE.test(name)) return TYPES.code
  if (ARCHIVE.test(name)) return TYPES.archive
  if (DOC.test(name) || m.startsWith("text/")) return TYPES.doc
  return TYPES.other
}

export const TAG_DOT = {
  red: "bg-tag-red",
  orange: "bg-tag-orange",
  yellow: "bg-tag-yellow",
  green: "bg-tag-green",
  blue: "bg-tag-blue",
  purple: "bg-tag-purple",
  gray: "bg-tag-gray",
}

const UNITS = ["B", "KB", "MB", "GB", "TB"]

export function formatBytes(n: number) {
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${i ? n.toFixed(n < 10 ? 1 : 0) : n} ${UNITS[i]}`
}
