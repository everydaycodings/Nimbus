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

import { typeKeyOf } from "@/lib/file-rules"

export { DOC, formatBytes } from "@/lib/file-rules"

// Where a public page's files live: "/s/<token>" for a share link, and "t:<token>" or
// "a:<token>" (":" can't appear in a real token) for a transfer's "/t/<token>" or an album's "/a/<token>".
export const linkBase = (link: string) =>
  link.startsWith("t:")
    ? `/t/${link.slice(2)}`
    : link.startsWith("a:")
      ? `/a/${link.slice(2)}`
      : `/s/${link}`

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

export function fileType(
  kind: "file" | "folder",
  mime: string | null,
  name: string
) {
  return TYPES[typeKeyOf(kind, mime, name)]
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
