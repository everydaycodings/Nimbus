"use client"

import { TrashIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Comment = { id: string; body: string; at: string; who: string; mine: boolean }
const stamp = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

// A flat thread on a secret or a change request.
export function Comments({
  projectId,
  target,
  admin,
}: {
  projectId: string
  target: { secretId: string } | { requestId: string }
  admin: boolean
}) {
  const q = "secretId" in target ? `secretId=${target.secretId}` : `requestId=${target.requestId}`
  const [items, setItems] = useState<Comment[] | null>(null)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api<{ comments: Comment[] }>(`/projects/${projectId}/comments?${q}`)
        .then((r) => setItems(r.comments))
        .catch((e) => setError(errorText(e))),
    [projectId, q]
  )
  useEffect(() => {
    load()
  }, [load])

  return (
    <section aria-label="Comments" className="grid gap-3">
      <h3 className="text-sm font-medium">Comments{items?.length ? ` (${items.length})` : ""}</h3>
      {items?.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
      <ul className="grid gap-2">
        {items?.map((c) => (
          <li key={c.id} className="group rounded-lg border bg-muted/20 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{c.who}</span>
              {stamp.format(new Date(c.at))}
              {(c.mine || admin) && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label="Delete comment"
                  onClick={async () => {
                    await api(`/projects/${projectId}/comments?id=${c.id}`, "DELETE").catch((e) => setError(errorText(e)))
                    load()
                  }}
                >
                  <TrashIcon />
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          try {
            const r = await api<{ comments: Comment[] }>(`/projects/${projectId}/comments`, "POST", { ...target, body: text })
            setItems(r.comments)
            setText("")
            setError(null)
          } catch (err) {
            setError(errorText(err))
          }
        }}
      >
        <Input aria-label="Write a comment" placeholder="Write a comment" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        <Button type="submit" variant="outline" disabled={!text.trim()}>
          Comment
        </Button>
      </form>
      <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
    </section>
  )
}
