import type { SystemKind } from "@nimbus/shared/api"
import {
  CameraIcon,
  DeviceMobileIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileDocIcon,
  FileIcon,
  FileTextIcon,
  FileImageIcon,
  FilePdfIcon,
  FileVideoIcon,
  FileZipIcon,
  FolderIcon,
  UsersThreeIcon,
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

// Folders the app makes itself: their own icon and label, and what to warn before a change.
export const SYSTEM: Record<
  SystemKind,
  {
    icon: typeof FolderIcon
    label: string
    // Fits "…puts new photos in Camera. If you <change>, …".
    warn: string
    effect: { rename: string; move: string; delete: string }
  }
> = {
  camera: {
    icon: CameraIcon,
    label: "Auto · Photo backup",
    warn: "Photo backup puts new photos in Camera.",
    effect: {
      rename: "the next backup makes a new Camera folder",
      move: "the next backup makes a new Camera folder",
      delete: "the next backup makes a new Camera folder and uploads your photos again",
    },
  },
  phone_backup: {
    icon: DeviceMobileIcon,
    label: "Auto · Contacts and calendar",
    warn: "Phone backup saves your contacts and calendar in Phone backup.",
    effect: {
      rename: "the next backup makes a new Phone backup folder",
      move: "the next backup makes a new Phone backup folder",
      delete: "the next backup makes a new Phone backup folder and the saved copies are gone",
    },
  },
  documents: {
    icon: FileTextIcon,
    label: "Auto · Documents",
    warn: "Documents files new scans and uploads in Documents, by year.",
    effect: {
      rename: "the next scan or upload makes a new Documents folder",
      move: "the next scan or upload makes a new Documents folder",
      delete: "the next scan or upload makes a new Documents folder",
    },
  },
  partner: {
    icon: UsersThreeIcon,
    label: "Auto · Partner photos",
    warn: "Saved partner photos go in this folder.",
    effect: {
      rename: "saving partner photos again makes a new folder",
      move: "saving partner photos again makes a new folder",
      delete: "the saved copies are gone, and saving again makes a new folder",
    },
  },
}

const VERB = { rename: "rename it", move: "move it", delete: "delete it" }

// The confirm text for changing a system folder; several kinds join into one message.
export function systemWarning(
  kinds: SystemKind[],
  action: "rename" | "move" | "delete"
) {
  return [...new Set(kinds)]
    .map((k) => `${SYSTEM[k].warn} If you ${VERB[action]}, ${SYSTEM[k].effect[action]}.`)
    .join(" ")
}
