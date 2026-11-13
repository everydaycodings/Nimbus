"use client"

import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { api, copySecret, errorText } from "@/components/secrets/client"
import { Modal, SELECT } from "@/components/secrets/ui"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const EXPIRY = [
  [60, "1 hour"],
  [240, "4 hours"],
  [1440, "1 day"],
  [10080, "7 days"],
  [43200, "30 days"],
] as const

// A one-time link for text you paste, or for a secret of a project (the browser
// never sees its value). Anyone with the link can open it, account or not.
export function ShareDialog({
  from,
  onClose,
  onMade,
}: {
  from?: { projectId: string; secretId: string; key: string }
  onClose: () => void
  onMade?: () => void
}) {
  const [text, setText] = useState("")
  const [minutes, setMinutes] = useState(1440)
  const [views, setViews] = useState(1)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  return (
    <Modal
      title={from ? `Share ${from.key}` : "Share a secret once"}
      description={from ? "The link opens the current value, once it's clicked." : "Paste any text. The link opens it for someone without an account, then burns."}
      onClose={onClose}
    >
      {url ? (
        <div className="grid gap-3">
          <Label htmlFor="share-url">Your link</Label>
          <div className="flex gap-2">
            <Input id="share-url" readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              onClick={async () => {
                await copySecret(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This is the only time you&apos;ll see the link. Revoke it any time from Share links.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            try {
              const r = await api<{ token: string }>("/shares", "POST", {
                ...(from ? { projectId: from.projectId, secretId: from.secretId } : { text }),
                minutes,
                maxViews: views,
                ...(password && { password }),
              })
              setUrl(`${window.location.origin}/s/${r.token}`)
              onMade?.()
            } catch (err) {
              setError(errorText(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          {!from && (
            <div className="grid gap-2">
              <Label htmlFor="share-text">Text to share</Label>
              <textarea
                id="share-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={100_000}
                autoFocus
                spellCheck={false}
                className="field-sizing-content block max-h-60 min-h-24 w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="share-expiry">Expires after</Label>
              <select id="share-expiry" className={SELECT} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {EXPIRY.map(([m, l]) => (
                  <option key={m} value={m}>{l}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="share-views">Can be opened</Label>
              <select id="share-views" className={SELECT} value={views} onChange={(e) => setViews(Number(e.target.value))}>
                {[1, 2, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>{n === 1 ? "once" : `${n} times`}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="share-password">Password (optional)</Label>
            <Input id="share-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} />
            <p className="text-xs text-muted-foreground">Send it by a different route than the link.</p>
          </div>
          <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <SubmitButton pending={busy} disabled={!from && !text}>Create link</SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  )
}
