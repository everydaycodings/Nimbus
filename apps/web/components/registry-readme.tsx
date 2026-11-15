"use client"

import { PencilSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useState, useTransition } from "react"

import { saveReadme } from "@/app/(app)/registry/actions"
import { Heading, SECTION, TOUCH } from "@/components/registry-ui"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type Readme = { source: "custom" | "annotation" | null; markdown: string | null; sourceUrl: string | null }

// Markdown to safe HTML: no images (they would call out from the viewer's browser), links open in a new tab.
function useRendered(md: string) {
  const [html, setHtml] = useState("")
  useEffect(() => {
    let live = true
    Promise.all([import("marked"), import("dompurify")]).then(async ([{ marked }, { default: DOMPurify }]) => {
      DOMPurify.removeHook("afterSanitizeAttributes")
      DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName !== "A") return
        node.setAttribute("target", "_blank")
        node.setAttribute("rel", "noopener noreferrer")
      })
      const out = DOMPurify.sanitize(await marked.parse(md), { FORBID_TAGS: ["style", "form", "img", "iframe"] })
      if (live) setHtml(out)
    })
    return () => {
      live = false
    }
  }, [md])
  return html
}

const Article = ({ md }: { md: string }) => {
  const html = useRendered(md)
  return <article className="markdown min-w-0 break-words" dangerouslySetInnerHTML={{ __html: html }} />
}

const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null)

export function RepoReadme({ name, canWrite, readme }: { name: string; canWrite: boolean; readme: Readme }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(readme.markdown ?? "")
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const setNotice = useNotice()
  const link = safeUrl(readme.sourceUrl)

  const save = (md: string | null) =>
    start(async () => {
      setError(undefined)
      const r = await saveReadme(name, md)
      if (r.error) return setError(r.error)
      setEditing(false)
      setPreview(false)
      setNotice({ text: md === null ? "Using the image label again." : "README saved." })
    })

  return (
    <section className={SECTION} aria-labelledby="readme-heading">
      <Heading
        id="readme-heading"
        title="README"
        hint={
          readme.source === "annotation" ? (
            <>
              From image label{link && (
                <>
                  {" · "}
                  <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    Source
                  </a>
                </>
              )}
            </>
          ) : readme.source === "custom" ? (
            "Custom, written here."
          ) : (
            "Describe this image for people who find it."
          )
        }
      >
        {canWrite && !editing && (
          <Button
            variant="outline"
            className={TOUCH}
            onClick={() => {
              setDraft(readme.markdown ?? "")
              setEditing(true)
            }}
          >
            <PencilSimpleIcon />
            {readme.source ? "Edit" : "Add a README"}
          </Button>
        )}
      </Heading>
      {editing ? (
        <form
          className="grid gap-3 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault()
            save(draft.trim() ? draft : null)
          }}
        >
          <div className="flex items-center gap-2">
            <Label htmlFor="readme-text" className="mr-auto">
              Markdown
            </Label>
            <div className="flex rounded-md bg-muted p-[3px]">
              {([false, true] as const).map((p) => (
                <button
                  key={String(p)}
                  type="button"
                  aria-pressed={preview === p}
                  onClick={() => setPreview(p)}
                  className="h-6 rounded-[5px] border border-transparent px-2 text-xs font-medium text-muted-foreground aria-pressed:border-input aria-pressed:bg-input/30 aria-pressed:text-foreground pointer-coarse:h-9 pointer-coarse:px-3"
                >
                  {p ? "Preview" : "Write"}
                </button>
              ))}
            </div>
          </div>
          {preview ? (
            draft.trim() ? <Article md={draft} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
          ) : (
            <textarea
              id="readme-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              maxLength={50000}
              spellCheck={false}
              className={cn(
                "w-full min-w-0 rounded-md border border-input bg-input/20 p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              )}
            />
          )}
          <FormError>{error}</FormError>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pending={pending} className={TOUCH}>
              Save
            </SubmitButton>
            <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {readme.source === "custom" && (
              <Button type="button" variant="outline" className={cn(TOUCH, "ml-auto")} disabled={pending} onClick={() => save(null)}>
                Reset to image label
              </Button>
            )}
          </div>
        </form>
      ) : readme.source ? (
        <div className="rounded-xl border bg-card p-4">
          <Article md={readme.markdown ?? ""} />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No README. Set the <code className="font-mono">org.opencontainers.image.description</code> label when you build, or write one here.
        </p>
      )}
    </section>
  )
}
