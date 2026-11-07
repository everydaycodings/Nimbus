"use client"

import { Dialog } from "@base-ui/react/dialog"
import { LinkBreakIcon, WarningIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import {
  createVaultLink,
  listVaultLinks,
  revokeVaultLink,
  vaultTree,
} from "@/app/(app)/vault/actions"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { usePasswordPolicy } from "@/components/password-input"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PassphraseFields } from "@/components/vault-list"
import { passwordProblem } from "@/lib/password-policy"
import type { VaultLinkRow } from "@/lib/services/vault"
import { cn } from "@/lib/utils"
import {
  decName,
  encName,
  exportLinkKey,
  linkKeyWrap,
  newLinkKey,
  openFileKey,
  sealManifest,
  wrapForLink,
  type LinkFile,
} from "@/lib/vault-crypto"

export type LinkTarget = {
  id: string
  kind: "file" | "folder"
  name: string
  mime: string | null
  size: number
}

const MAX_FILES = 5000
const SELECT =
  "h-9 rounded-md border border-input bg-input/30 px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// The link is a snapshot of what's in these items now. Nothing is copied: each file's key is
// re-wrapped under a new link key, which lives in the URL's # (or behind a passphrase).
export function ShareLinkDialog({
  vault,
  vk,
  targets,
  kidsOf,
  onClose,
}: {
  vault: { id: string; name: string }
  vk: CryptoKey
  targets: LinkTarget[]
  kidsOf: (id: string) => LinkTarget[]
  onClose: () => void
}) {
  const [mode, setMode] = useState<"key" | "pass">("key")
  const [days, setDays] = useState("7")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const policy = usePasswordPolicy()

  const label =
    targets.length === 1 ? targets[0].name : plural(targets.length, "item")

  async function submit(form: FormData) {
    const pass = String(form.get("pass") ?? "")
    if (mode === "pass") {
      const problem = passwordProblem(pass, policy, true)
      if (problem) return setError(problem)
      if (pass !== form.get("again"))
        return setError("The passphrases don't match.")
    }
    setPending(true)
    setError(null)
    try {
      const files: { n: LinkTarget; path: string }[] = []
      const walk = (n: LinkTarget, path: string) => {
        if (n.kind === "folder")
          for (const k of kidsOf(n.id)) walk(k, `${path}/${k.name}`)
        else files.push({ n, path })
      }
      for (const t of targets) walk(t, t.name)
      if (!files.length)
        throw new Error("There are no files to share in there.")
      if (files.length > MAX_FILES)
        throw new Error(`A link can hold up to ${MAX_FILES} files.`)

      // Fresh from the server: the wrapped keys and the version each belongs to.
      const rows = new Map((await vaultTree(vault.id))?.map((r) => [r.id, r]))
      const lk = await newLinkKey()
      const manifest: LinkFile[] = []
      for (const { n, path } of files) {
        const r = rows.get(n.id)
        if (!r?.encKey || !r.versionId)
          throw new Error("A file changed. Refresh and try again.")
        manifest.push({
          path,
          size: n.size,
          mime: n.mime,
          versionId: r.versionId,
          fileKey: await wrapForLink(lk, await openFileKey(vk, r.encKey)),
        })
      }
      const wrapped = mode === "pass" ? await linkKeyWrap(pass, lk) : null
      const res = await createVaultLink(vault.id, {
        manifest: await sealManifest(lk, manifest),
        label: await encName(vk, { n: label, t: null }),
        versionIds: manifest.map((m) => m.versionId),
        expiresInDays: days === "never" ? null : (Number(days) as 1 | 7 | 30),
        passphrase: wrapped
          ? { salt: wrapped.salt, kdf: wrapped.kdf, wrapped: wrapped.wrapped }
          : undefined,
      })
      if (res.error || !res.token) throw new Error(res.error)
      // The # never reaches the server.
      setUrl(
        `${location.origin}/v/${res.token}${wrapped ? "" : `#${await exportLinkKey(lk)}`}`
      )
    } catch (e) {
      setError((e as Error).message || "Couldn't make the link. Try again.")
    }
    setPending(false)
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              Share link for {label}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              The files stay encrypted on the server. The link carries the key
              that opens just these files, not your vault.
            </Dialog.Description>
          </div>
          {url ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={url}
                  aria-label="Link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton value={url} />
              </div>
              <p className="flex gap-2 text-sm text-muted-foreground">
                <WarningIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
                <span>
                  Anyone with this link can open these files. Revoke it to stop
                  that.
                  {mode === "pass" &&
                    " They also need the passphrase, so send it another way."}
                  {mode === "key" &&
                    " This link can't be shown again, so copy it now."}
                </span>
              </p>
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                submit(new FormData(e.currentTarget))
              }}
            >
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Opens with</legend>
                {(
                  [
                    [
                      "key",
                      "The link alone",
                      "Simplest. Anyone you send it to can open it.",
                    ],
                    [
                      "pass",
                      "A passphrase too",
                      "You send the link and the passphrase separately.",
                    ],
                  ] as const
                ).map(([v, title, hint]) => (
                  <label
                    key={v}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                      mode === v && "border-ring bg-input/30"
                    )}
                  >
                    <input
                      type="radio"
                      name="mode"
                      className="mt-1"
                      checked={mode === v}
                      onChange={() => setMode(v)}
                    />
                    <span className="grid">
                      <span className="font-medium">{title}</span>
                      <span className="text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {mode === "pass" && <PassphraseFields label="Link passphrase" />}
              <div className="grid gap-2">
                <label htmlFor="link-days" className="text-sm font-medium">
                  Expires
                </label>
                <select
                  id="link-days"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className={SELECT}
                >
                  <option value="1">In 1 day</option>
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                  <option value="never">Never</option>
                </select>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Dialog.Close
                  disabled={pending}
                  render={<Button variant="outline" />}
                >
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending}>Create link</SubmitButton>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type Row = VaultLinkRow & { name: string }

// The vault's links, with labels opened here. Key links can't be copied again: the key was only
// ever in the URL, so revoke and make a new one.
export function LinksDialog({
  vaultId,
  vk,
  onClose,
}: {
  vaultId: string
  vk: CryptoKey
  onClose: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sure, setSure] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listVaultLinks(vaultId)
      .then(async (links) => {
        if (!links) throw new Error()
        const named = await Promise.all(
          links.map(async (l) => ({
            ...l,
            name: (await decName(vk, l.label).catch(() => null))?.n ?? "Link",
          }))
        )
        if (live) setRows(named)
      })
      .catch(() => live && setError("Couldn't load your links."))
    return () => {
      live = false
    }
  }, [vaultId, vk])

  async function revoke(id: string) {
    setSure(null)
    const res = await revokeVaultLink(vaultId, id).catch(() => ({
      error: "Couldn't revoke that link. Try again.",
    }))
    if (res.error) return setError(res.error)
    setError(null)
    setRows((r) => r && r.filter((x) => x.id !== id))
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[85svh] max-w-lg")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              Shared links
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Revoking a link stops it working for good.
            </Dialog.Description>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="-mx-2 flex min-h-0 flex-col overflow-y-auto px-2">
            {!rows && !error && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            )}
            {rows?.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <LinkBreakIcon className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No links yet. Pick a file or folder and choose Share link.
                </p>
              </div>
            )}
            {rows?.map((r) => {
              const expired = r.expiresAt && new Date(r.expiresAt) < new Date()
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 border-b py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {plural(r.files, "file")} · made{" "}
                      {date.format(new Date(r.createdAt))} ·{" "}
                      {expired
                        ? "expired"
                        : r.expiresAt
                          ? `expires ${date.format(new Date(r.expiresAt))}`
                          : "no expiry"}{" "}
                      · {plural(r.viewCount, "view")}
                      {r.passphrase && " · passphrase"}
                    </p>
                  </div>
                  {sure === r.id ? (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => revoke(r.id)}
                      >
                        Revoke
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSure(null)}
                      >
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSure(r.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-end">
            <Dialog.Close render={<Button variant="outline" />}>
              Close
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
