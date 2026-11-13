"use client"

import { CaretRightIcon, FolderSimpleIcon } from "@phosphor-icons/react"

// Where you are: "All secrets / app / api", each part a way back up.
export function FolderBar({
  root,
  path,
  onOpen,
}: {
  root: string
  path: string
  onOpen: (path: string) => void
}) {
  const parts = path.split("/").filter(Boolean)
  return (
    <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
      <button
        className="rounded px-1 font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => onOpen("")}
        aria-current={parts.length ? undefined : "page"}
      >
        {root}
      </button>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          <CaretRightIcon className="size-3 text-muted-foreground" />
          <button
            className="flex items-center gap-1 rounded px-1 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => onOpen(parts.slice(0, i + 1).join("/"))}
            aria-current={i === parts.length - 1 ? "page" : undefined}
          >
            <FolderSimpleIcon className="size-3.5 text-file-folder" />
            {p}
          </button>
        </span>
      ))}
    </nav>
  )
}
