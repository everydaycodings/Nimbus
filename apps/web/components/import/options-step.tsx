"use client"

import { RADIO_INPUT } from "@/components/registry-ui"
import type { ImportOptions } from "@/lib/import/rules"

const OPTION =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm has-[:checked]:border-ring/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"

type Row = { key: keyof ImportOptions; title: string; text: string; only?: "drive" }

const ROWS: Row[] = [
  { key: "keepDates", title: "Keep the original dates", text: "Files show when they were last changed at the source, not when they arrived." },
  { key: "mirror", title: "Keep the folder structure", text: "Recreate the folders you ticked inside the target. Off puts every file straight into the target." },
  { key: "sharedWithMe", title: "Include files shared with me", text: "Google Drive only. They go into a “Shared with me” folder.", only: "drive" },
  { key: "stars", title: "Keep stars", text: "Starred items at the source become starred in Nimbus.", only: "drive" },
  { key: "descriptions", title: "Keep descriptions", text: "A file's description becomes a comment on it.", only: "drive" },
]

// The import's options. Google Drive's extras (shared, stars, descriptions) show only for Drive; a Takeout import gets stars
// and descriptions from the photos' own metadata, and always keeps the date the photo was taken.
export function OptionsStep({ value, onChange, drive, takeout }: { value: ImportOptions; onChange: (o: ImportOptions) => void; drive: boolean; takeout: boolean }) {
  const rows = ROWS.filter((r) => (takeout ? r.key === "mirror" || r.key === "stars" || r.key === "descriptions" : r.only !== "drive" || drive))
  return (
    <div className="grid gap-2">
      {rows.map((r) => (
        <label key={r.key} className={OPTION}>
          <input type="checkbox" className={`${RADIO_INPUT} mt-0.5 pointer-coarse:size-5`} checked={value[r.key]} onChange={(e) => onChange({ ...value, [r.key]: e.target.checked })} />
          <span className="grid gap-0.5">
            <span className="font-medium">{r.title}</span>
            <span className="text-muted-foreground">{takeout && r.key === "stars" ? "Photos you marked as favorites become starred." : takeout && r.key === "descriptions" ? "A photo's description becomes a comment on it." : r.text}</span>
          </span>
        </label>
      ))}
      <p className="text-sm text-pretty text-muted-foreground">
        {takeout ? "Photos get the date they were taken, read from the zip's JSON files. Those files themselves aren't imported." : "Files that are already in Nimbus with the same content are skipped. Others with the same name are kept side by side as “name (2)”."}
      </p>
    </div>
  )
}
