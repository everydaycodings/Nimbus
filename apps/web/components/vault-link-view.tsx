"use client"

import {
  DownloadSimpleIcon,
  EyeIcon,
  LinkBreakIcon,
  LockKeyIcon,
} from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"

import { Previewer, type Decrypted } from "@/components/previewer"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  pickSaveTarget,
  saveStream,
  zipDownload,
} from "@/lib/client-zip-download"
import { previewKind } from "@/lib/file-rules"
import { fileType, formatBytes } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { cn } from "@/lib/utils"
import {
  decryptStream,
  importLinkKey,
  linkKeyUnwrap,
  openManifest,
  unwrapFromLink,
  type LinkFile,
} from "@/lib/vault-crypto"

export type LinkKdf = { salt: string; t: number; m: number; wrapped: string }

// Previews decrypt the whole file into memory first; bigger files download.
// ponytail: videos too, so a big one downloads fully before it plays. Range-streaming
// through a service worker would fix that; not worth it for shared links yet.
const VIEW_MAX = 1024 ** 3

const NOT_THERE = "This file was removed from the vault."

const asItem = (f: LinkFile): Item => ({
  id: f.versionId,
  kind: "file",
  name: f.path.split("/").pop()!,
  size: f.size,
  mime: f.mime,
  starred: false,
  updatedAt: new Date().toISOString(),
  trashedAt: null,
  tags: [],
  version: null,
  thumb: "",
  sharedWithPeople: false,
  hasLink: false,
})

// All the decrypting happens here: the server only ever sees the sealed manifest and ciphertext.
export function VaultLinkView({
  token,
  manifest,
  kdf,
  available,
}: {
  token: string
  manifest: string
  // Passphrase mode: the link key is wrapped and the URL has none.
  kdf: LinkKdf | null
  // Versions the server still has; the rest were deleted from the vault.
  available: string[]
}) {
  const [lk, setLk] = useState<CryptoKey | null>(null)
  const [files, setFiles] = useState<LinkFile[] | null>(null)
  const [broken, setBroken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [viewing, setViewing] = useState<LinkFile | null>(null)
  const [src, setSrc] = useState<Decrypted>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const have = useMemo(() => new Set(available), [available])

  async function unlock(key: CryptoKey) {
    setFiles(await openManifest(key, manifest))
    setLk(key)
  }

  // Key mode: the key is the URL's #, which never went to the server.
  useEffect(() => {
    if (kdf) return
    importLinkKey(location.hash.slice(1))
      .then(unlock)
      .catch(() => setBroken(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kdf, manifest])

  async function submitPass(form: FormData) {
    if (!kdf) return
    setPending(true)
    setError(null)
    try {
      await unlock(
        await linkKeyUnwrap(String(form.get("pass")), kdf.salt, kdf.wrapped, {
          t: kdf.t,
          m: kdf.m,
        })
      )
    } catch {
      setError("That passphrase isn't right.")
    }
    setPending(false)
  }

  async function plaintext(f: LinkFile, signal?: AbortSignal) {
    const fk = await unwrapFromLink(lk!, f.fileKey)
    const res = await fetch(`/v/${token}/blob/${f.versionId}`, { signal })
    if (res.status === 404) throw new Error(NOT_THERE)
    if (!res.ok || !res.body) throw new Error("Couldn't download the file.")
    return res.body.pipeThrough(decryptStream(fk))
  }

  const name = (f: LinkFile) => f.path.split("/").pop()!
  const viewable = (f: LinkFile) =>
    have.has(f.versionId) &&
    f.size <= VIEW_MAX &&
    previewKind(f.mime, name(f)) !== null
  const list = useMemo(
    () =>
      [...(files ?? [])].sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true })
      ),
    [files]
  )
  const stepList = list.filter(viewable)

  // The previewed file, decrypted into memory; freed when it changes.
  useEffect(() => {
    if (!viewing) return
    const abort = new AbortController()
    let url: string | null = null
    plaintext(viewing, abort.signal)
      .then((body) => new Response(body).blob())
      .then((bytes) => {
        if (abort.signal.aborted) return
        const blob = new Blob([bytes], { type: viewing.mime ?? "" })
        url = URL.createObjectURL(blob)
        setSrc({ blob, url })
      })
      .catch((e: Error) => {
        if (abort.signal.aborted) return
        setViewing(null)
        setError(
          e.message === NOT_THERE
            ? NOT_THERE
            : `Couldn't open “${name(viewing)}”.`
        )
      })
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing])

  function show(f: LinkFile | null) {
    setSrc(null)
    setError(null)
    setViewing(f)
  }

  async function download(f: LinkFile) {
    // The save picker needs the click, so it opens before anything else.
    const target = await pickSaveTarget(name(f))
    if (target === false) return
    setBusy(f.versionId)
    setError(null)
    try {
      await saveStream(
        await plaintext(f),
        target,
        name(f),
        new AbortController().signal
      )
    } catch (e) {
      setError(
        (e as Error).message === NOT_THERE
          ? NOT_THERE
          : `Couldn't download “${name(f)}”.`
      )
    }
    setBusy(null)
  }

  async function zip() {
    const total = list.filter((f) => have.has(f.versionId))
    setBusy("zip")
    setError(null)
    try {
      await zipDownload(
        async (signal) => ({
          name: "Shared files",
          dirs: [],
          entries: total.map((f) => ({
            path: f.path,
            size: f.size,
            modified: new Date().toISOString(),
            open: () => plaintext(f, signal),
          })),
        }),
        "Shared files.zip",
        () => {},
        new AbortController().signal
      )
    } catch {
      setError("Couldn't build the zip. Try downloading the files one by one.")
    }
    setBusy(null)
  }

  if (broken)
    return (
      <Notice
        icon={<LinkBreakIcon className="size-10 text-muted-foreground" />}
        title="This link is incomplete"
        body="The part after # is missing, cut off or wrong. Ask for the link again and open it in full."
      />
    )

  if (!files)
    return kdf ? (
      <form
        className="mx-auto flex w-full max-w-sm flex-col gap-4 py-16"
        onSubmit={(e) => {
          e.preventDefault()
          submitPass(new FormData(e.currentTarget))
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <LockKeyIcon className="size-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Enter the passphrase</h1>
          <p className="text-sm text-muted-foreground">
            These files are encrypted. Whoever sent the link can give you the
            passphrase.
          </p>
        </div>
        <Input
          name="pass"
          type="password"
          autoComplete="off"
          autoFocus
          required
          aria-label="Passphrase"
          aria-invalid={Boolean(error)}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <SubmitButton pending={pending}>Open files</SubmitButton>
      </form>
    ) : (
      <p className="py-24 text-center text-sm text-muted-foreground">
        Opening…
      </p>
    )

  const gone = list.filter((f) => !have.has(f.versionId)).length
  const here = list.length - gone
  const at = stepList.findIndex((f) => f.versionId === viewing?.versionId)

  if (!list.length || !here)
    return (
      <Notice
        icon={<LinkBreakIcon className="size-10 text-muted-foreground" />}
        title="Nothing left to open"
        body="The files in this link were removed from the vault."
      />
    )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Shared files
          </h1>
          <p className="text-sm text-muted-foreground">
            {here} file{here === 1 ? "" : "s"} ·{" "}
            {formatBytes(list.reduce((n, f) => n + f.size, 0))} · decrypted in
            your browser
          </p>
        </div>
        {here > 1 && (
          <Button onClick={zip} disabled={busy === "zip"}>
            <DownloadSimpleIcon />
            {busy === "zip" ? "Zipping…" : "Download all"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {list.map((f) => {
          const t = fileType("file", f.mime, name(f))
          const dir = f.path.includes("/")
            ? f.path.slice(0, f.path.lastIndexOf("/") + 1)
            : ""
          const ok = have.has(f.versionId)
          return (
            <li key={f.versionId} className="flex items-center gap-3 p-3">
              <t.icon className={cn("size-5 shrink-0", t.color)} />
              <div className="min-w-0 flex-1">
                {ok && viewable(f) ? (
                  <button
                    type="button"
                    onClick={() => show(f)}
                    title={f.path}
                    className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {dir && (
                      <span className="font-normal text-muted-foreground">
                        {dir}
                      </span>
                    )}
                    {name(f)}
                  </button>
                ) : (
                  <p className="truncate text-sm font-medium" title={f.path}>
                    {dir && (
                      <span className="font-normal text-muted-foreground">
                        {dir}
                      </span>
                    )}
                    {name(f)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {ok ? formatBytes(f.size) : "Removed from the vault"}
                </p>
              </div>
              {ok && viewable(f) && (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Open ${name(f)}`}
                  title="Open"
                  onClick={() => show(f)}
                >
                  <EyeIcon />
                </Button>
              )}
              {ok && (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Download ${name(f)}`}
                  title="Download"
                  disabled={busy === f.versionId}
                  onClick={() => download(f)}
                >
                  <DownloadSimpleIcon />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <Previewer
        shown={viewing ? { item: asItem(viewing) } : null}
        open={Boolean(viewing)}
        onClose={() => show(null)}
        onPrev={at > 0 ? () => show(stepList[at - 1]) : undefined}
        onNext={
          at >= 0 && at < stepList.length - 1
            ? () => show(stepList[at + 1])
            : undefined
        }
        position={at >= 0 ? `${at + 1} of ${stepList.length}` : undefined}
        src={src}
      />
    </div>
  )
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-24 text-center">
      {icon}
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
