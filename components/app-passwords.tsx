"use client"

import { Dialog } from "@base-ui/react/dialog"
import { PlusIcon } from "@phosphor-icons/react"
import { useState, useTransition } from "react"

import {
  createAppPassword,
  revokeAppPassword,
} from "@/app/(app)/account/actions"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type AppPassword = {
  id: string
  name: string
  scope: "rw" | "ro"
  lastFour: string
  created: string
  lastUsed: string | null
  lastIp: string | null
}

const SCOPES = [
  { value: "rw", label: "Read & write", hint: "Open, add, change and delete files." },
  { value: "ro", label: "Read only", hint: "Open and download, nothing else." },
]

// Account → Connect a device: the WebDAV address and app passwords.
export function AppPasswords({
  url,
  email,
  items,
}: {
  url: string
  email: string
  items: AppPassword[]
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const close = () => {
    setOpen(false)
    setPassword(undefined)
    setError(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="dav-url">Server address</Label>
        <div className="flex items-center gap-2">
          <Input id="dav-url" readOnly value={url} className="font-mono" />
          <CopyButton value={url} />
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in with your email, <span className="font-medium">{email}</span>,
          and an app password. Your account password and two-factor aren&apos;t
          used here.
        </p>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="flex items-center gap-2 truncate font-medium">
                  {p.name}
                  <Badge variant="outline">
                    {p.scope === "ro" ? "Read only" : "Read & write"}
                  </Badge>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  •••• {p.lastFour} · Created {p.created} ·{" "}
                  {p.lastUsed
                    ? `Last used ${p.lastUsed}${p.lastIp ? ` from ${p.lastIp}` : ""}`
                    : "Never used"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => start(() => revokeAppPassword(p.id))}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <PlusIcon />
        New app password
      </Button>

      <ConnectGuide url={url} email={email} />

      <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && close()}>
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">
                {password ? "Your new app password" : "New app password"}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {password
                  ? "Enter it in the app now. It's shown only once; if you lose it, revoke it and make another."
                  : "One per device, so you can revoke a lost laptop without touching the others. It stops working after 90 days unused."}
              </Dialog.Description>
            </div>
            {password ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="flex h-9 flex-1 items-center rounded-md border bg-input/20 px-3 font-mono text-sm tracking-wide select-all">
                    {password}
                  </code>
                  <CopyButton value={password} />
                </div>
                <div className="flex justify-end">
                  <Button onClick={close}>Done</Button>
                </div>
              </>
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  setError(null)
                  start(async () => {
                    const r = await createAppPassword(
                      String(f.get("name") ?? ""),
                      String(f.get("scope") ?? "")
                    )
                    if (r.error) return setError(r.error)
                    setPassword(r.password)
                  })
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="app-pw-name">Device</Label>
                  <Input
                    id="app-pw-name"
                    name="name"
                    maxLength={60}
                    placeholder="Laptop – Dolphin"
                    autoFocus
                  />
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Access</legend>
                  {SCOPES.map((s, i) => (
                    <label
                      key={s.value}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"
                    >
                      <input
                        type="radio"
                        name="scope"
                        value={s.value}
                        defaultChecked={i === 0}
                        className="size-4 accent-primary"
                      />
                      <span className="grid">
                        <span className="font-medium">{s.label}</span>
                        <span className="text-xs text-muted-foreground">{s.hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <FormError>{error}</FormError>
                <div className="flex justify-end gap-2">
                  <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
                    Cancel
                  </Dialog.Close>
                  <SubmitButton pending={pending}>Create</SubmitButton>
                </div>
              </form>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

const CODE =
  "block overflow-x-auto rounded bg-input/20 p-2 font-mono text-xs whitespace-pre"

function guides(url: string, email: string) {
  const secure = url.startsWith("https:")
  const host = url.replace(/^https?:\/\//, "")
  return [
    {
      id: "linux",
      label: "Linux",
      body: (
        <>
          <p>
            <b>GNOME Files:</b> Other Locations → Connect to Server, then{" "}
            <code>{`${secure ? "davs" : "dav"}://${host}`}</code>
          </p>
          <p>
            <b>KDE Dolphin:</b> type{" "}
            <code>{`${secure ? "webdavs" : "webdav"}://${host}`}</code> in the
            location bar.
          </p>
          <p>
            <b>As a folder:</b> use rclone (see its tab) with{" "}
            <code>rclone mount nimbus: ~/Nimbus --vfs-cache-mode writes</code>.
            davfs2 works on older systems but can&apos;t list folders on
            Linux 7 kernels.
          </p>
        </>
      ),
    },
    {
      id: "rclone",
      label: "rclone",
      body: (
        <>
          <p>Sync, back up or mount from any OS, and from scripts.</p>
          <code className={CODE}>
            {`rclone config create nimbus webdav url=${url} vendor=other user=${email} pass=$(rclone obscure 'APP-PASSWORD')\nrclone mount nimbus: ~/Nimbus --vfs-cache-mode writes\nrclone sync ~/Photos nimbus:Photos`}
          </code>
        </>
      ),
    },
    {
      id: "windows",
      label: "Windows",
      body: (
        <>
          <p>
            File Explorer → This PC → <b>Map network drive</b>. Folder:{" "}
            <code>{url}</code>, tick <b>Connect using different credentials</b>
            , then sign in.
          </p>
          <p>
            Windows only signs in over HTTPS{secure ? "" : ", which this address isn't, so use rclone instead"}.
            It also refuses files over 50 MB until{" "}
            <code>FileSizeLimitInBytes</code> under{" "}
            <code>HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters</code>{" "}
            is raised.
          </p>
        </>
      ),
    },
    {
      id: "mac",
      label: "macOS",
      body: (
        <p>
          Finder → Go → <b>Connect to Server</b> (⌘K), enter{" "}
          <code>{url}</code>, choose Registered User, then sign in. It shows up
          under Locations.
        </p>
      ),
    },
    {
      id: "phone",
      label: "Phones",
      body: (
        <p>
          Use an app with WebDAV, like Solid Explorer or Material Files on
          Android, or Documents by Readdle or FE File Explorer on iPhone and
          iPad (the Files app can&apos;t). Add a WebDAV server with{" "}
          <code>{url}</code>, your email and an app password.
        </p>
      ),
    },
  ]
}

function ConnectGuide({ url, email }: { url: string; email: string }) {
  const all = guides(url, email)
  const [tab, setTab] = useState(all[0].id)
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm [&_code]:font-mono [&_code]:text-xs">
      <p className="font-medium">How to connect</p>
      <div role="tablist" aria-label="Connection guide" className="flex flex-wrap gap-1">
        {all.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            id={`guide-${g.id}`}
            aria-selected={tab === g.id}
            aria-controls="guide-panel"
            onClick={() => setTab(g.id)}
            className="rounded-md px-2.5 py-1 text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-accent aria-selected:text-foreground"
          >
            {g.label}
          </button>
        ))}
      </div>
      <div
        id="guide-panel"
        role="tabpanel"
        aria-labelledby={`guide-${tab}`}
        className="flex flex-col gap-3 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground"
      >
        {all.find((g) => g.id === tab)!.body}
      </div>
    </div>
  )
}
