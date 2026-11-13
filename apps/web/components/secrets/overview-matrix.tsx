"use client"

import { CheckIcon, FolderSimpleIcon, MinusIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { FolderBar } from "@/components/secrets/folder-bar"
import type { Detail } from "@/components/secrets/project-view"
import { cn } from "@/lib/utils"

type Matrix = {
  envs: { id: string; name: string; slug: string }[]
  folders: string[]
  rows: {
    key: string
    cells: Record<string, { id: string; empty: boolean; invalid?: string }>
    required: { kind: string; pattern: string | null } | null
  }[]
}

// Keys down the side, environments across the top. A key an environment lacks
// is highlighted: that's where the next deploy will break.
export function OverviewMatrix({
  detail,
  folder,
  canWrite,
  onFolder,
  onOpen,
}: {
  detail: Detail
  folder: string
  canWrite: boolean
  onFolder: (p: string) => void
  onOpen: (envSlug: string, key: string | null) => void
}) {
  const [m, setM] = useState<Matrix | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api<Matrix>(`/projects/${detail.id}/overview?folder=${encodeURIComponent(folder)}`)
      .then((r) => live && (setM(r), setError(null)))
      .catch((e) => live && setError(errorText(e)))
    return () => {
      live = false
    }
  }, [detail.id, folder, detail.trash, detail.envs])

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!m) return <p className="text-sm text-muted-foreground">Loading…</p>

  const missing = m.rows.reduce((n, r) => n + m.envs.filter((e) => !r.cells[e.id]).length, 0)
  const invalid = m.rows.reduce((n, r) => n + m.envs.filter((e) => r.cells[e.id]?.invalid).length, 0)

  return (
    <div className="flex flex-col gap-4">
      <FolderBar root="Overview" path={folder} onOpen={onFolder} />
      {m.folders.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {m.folders.map((f) => (
            <li key={f}>
              <button
                onClick={() => onFolder(folder ? `${folder}/${f}` : f)}
                className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <FolderSimpleIcon className="size-4 text-file-folder" />
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
      {m.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            Open an environment to add secrets, paste a .env or import a file.
            They&apos;ll line up here across environments.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {missing
              ? `${missing} value${missing === 1 ? " is" : "s are"} missing in some environments.`
              : "Every key exists in every environment."}
            {invalid > 0 && ` ${invalid} ${invalid === 1 ? "doesn't" : "don't"} fit the required format.`}
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                  <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-2.5 font-medium">Key</th>
                  {m.envs.map((e) => (
                    <th key={e.id} scope="col" className="px-4 py-2.5 text-center font-medium">
                      {e.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-mono text-sm font-normal">
                      {r.key}
                      {r.required && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground" title="Required in every environment">
                          required
                        </span>
                      )}
                    </th>
                    {m.envs.map((e) => {
                      const c = r.cells[e.id]
                      return (
                        <td key={e.id} className={cn("p-1 text-center", (!c || c.invalid) && "bg-destructive/10")}>
                          <button
                            onClick={() => onOpen(e.slug, c ? null : r.key)}
                            disabled={!c && !canWrite}
                            title={c?.invalid}
                            aria-label={
                              c
                                ? `${r.key} in ${e.name}: ${c.invalid ? `invalid, ${c.invalid}` : c.empty ? "empty" : "set"}. Open`
                                : `${r.key} is missing in ${e.name}. ${canWrite ? "Add it" : ""}`
                            }
                            className={cn(
                              "mx-auto flex h-8 min-w-16 items-center justify-center gap-1 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                              c
                                ? c.invalid
                                  ? "font-medium text-destructive hover:bg-destructive/15"
                                  : c.empty
                                    ? "text-warning hover:bg-warning/10"
                                    : "text-muted-foreground hover:bg-muted"
                                : "font-medium text-destructive hover:bg-destructive/15"
                            )}
                          >
                            {c ? (
                              c.invalid ? (
                                <>
                                  <WarningIcon /> Invalid
                                </>
                              ) : c.empty ? (
                                <>
                                  <MinusIcon /> Empty
                                </>
                              ) : (
                                <CheckIcon />
                              )
                            ) : (
                              <>
                                <PlusIcon /> Missing
                              </>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
