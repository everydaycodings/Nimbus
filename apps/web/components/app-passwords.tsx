"use client"

import { Dialog } from "@base-ui/react/dialog"
import { PlusIcon } from "@phosphor-icons/react"
import { useState, useSyncExternalStore, useTransition } from "react"

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

const Steps = ({ children }: { children: React.ReactNode }) => (
  <ol className="flex list-decimal flex-col gap-1.5 pl-5">{children}</ol>
)

const Way = ({
  title,
  tag,
  children,
}: {
  title: string
  tag?: string
  children: React.ReactNode
}) => (
  <div className="flex flex-col gap-2">
    <p className="flex items-center gap-2 font-medium text-foreground">
      {title}
      {tag && <Badge variant="outline">{tag}</Badge>}
    </p>
    {children}
  </div>
)

// Built-in clients drop the connection when the device sleeps; the
// recommended apps keep the password and reconnect on their own.
function guides(url: string, email: string) {
  const secure = url.startsWith("https:")
  const host = url.replace(/^https?:\/\//, "")
  const signIn = (
    <li>
      Username <b>{email}</b>, password: a new app password from above (one per
      device). Tick <b>Remember</b> if asked.
    </li>
  )
  return [
    {
      id: "windows",
      label: "Windows",
      body: (
        <>
          <Way title="RaiDrive" tag="Recommended">
            <Steps>
              <li>Install RaiDrive (free) from raidrive.com.</li>
              <li>
                Click <b>Add</b>, choose <b>NAS → WebDAV</b>, untick{" "}
                <b>Address</b> autodetect and paste <code>{url}</code>
                {secure ? ", keep Secure connection ticked" : ", untick Secure connection"}.
              </li>
              {signIn}
              <li>Click <b>Connect</b>. Nimbus shows up as a drive in File Explorer and reconnects after sleep or restart.</li>
            </Steps>
          </Way>
          <Way title="Built into Windows">
            <Steps>
              <li>Open File Explorer, right-click <b>This PC</b> → <b>Map network drive</b>.</li>
              <li>
                Folder: <code>{url}</code>. Tick <b>Reconnect at sign-in</b> and{" "}
                <b>Connect using different credentials</b>.
              </li>
              {signIn}
            </Steps>
            <p>
              {secure ? "" : "Windows only signs in over HTTPS, which this address isn't, so use RaiDrive. "}
              It may disconnect after sleep (open the drive again to reconnect)
              and refuses files over 50 MB until <code>FileSizeLimitInBytes</code>{" "}
              under <code>HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters</code>{" "}
              is raised.
            </p>
          </Way>
        </>
      ),
    },
    {
      id: "mac",
      label: "Mac",
      body: (
        <>
          <Way title="Mountain Duck" tag="Recommended">
            <Steps>
              <li>Install Mountain Duck from mountainduck.io (paid, free trial).</li>
              <li>
                Open it from the menu bar → <b>Open Connection</b>, choose{" "}
                <b>WebDAV ({secure ? "HTTPS" : "HTTP"})</b> and paste <code>{url}</code>.
              </li>
              {signIn}
              <li>Click <b>Connect</b>. It stays in Finder and reconnects after sleep.</li>
            </Steps>
          </Way>
          <Way title="Built into macOS">
            <Steps>
              <li>In Finder press <b>⌘K</b> (Go → Connect to Server) and enter <code>{url}</code>.</li>
              <li>Choose <b>Registered User</b>, then sign in:</li>
              {signIn}
              <li>
                To connect at login, open System Settings → General → <b>Login
                Items</b> and drag the Nimbus drive in.
              </li>
            </Steps>
            <p>After sleep, click Nimbus under Locations in Finder to reconnect.</p>
          </Way>
        </>
      ),
    },
    {
      id: "linux",
      label: "Linux",
      body: (
        <>
          <Way title="GNOME (Ubuntu, Fedora)" tag="Recommended">
            <Steps>
              <li>Open Settings → <b>Online Accounts</b> → <b>WebDAV</b> (GNOME 46 or newer).</li>
              <li>Server: <code>{url}</code></li>
              {signIn}
              <li>Nimbus appears in the Files sidebar and reconnects by itself.</li>
            </Steps>
            <p>
              Older GNOME: Files → Other Locations → Connect to Server,{" "}
              <code>{`${secure ? "davs" : "dav"}://${host}`}</code>. Reconnect after sleep by
              clicking it in the sidebar.
            </p>
          </Way>
          <Way title="KDE (Dolphin)">
            <Steps>
              <li>
                Type <code>{`${secure ? "webdavs" : "webdav"}://${host}`}</code> in the
                location bar and press Enter.
              </li>
              {signIn}
              <li>Right-click the folder in Places → <b>Add to Places</b>.</li>
            </Steps>
          </Way>
        </>
      ),
    },
    {
      id: "ios",
      label: "iPhone & iPad",
      body: (
        <Way title="Documents by Readdle" tag="Recommended">
          <Steps>
            <li>Install <b>Documents by Readdle</b> (free) from the App Store. FE File Explorer works too.</li>
            <li>Tap <b>+</b> → <b>Connection</b> → <b>WebDAV server</b>.</li>
            <li>URL: <code>{url}</code></li>
            {signIn}
          </Steps>
          <p>Apple&apos;s Files app can&apos;t connect to WebDAV on its own.</p>
        </Way>
      ),
    },
    {
      id: "android",
      label: "Android",
      body: (
        <Way title="Material Files" tag="Recommended">
          <Steps>
            <li>Install <b>Material Files</b> (free) from Google Play or F-Droid. Solid Explorer works too.</li>
            <li>Open the menu → <b>Add storage</b> → <b>WebDAV server</b>.</li>
            <li>
              Host: <code>{host.split("/")[0]}</code>, path:{" "}
              <code>/{host.split("/").slice(1).join("/")}</code>, protocol{" "}
              {secure ? "HTTPS" : "HTTP"}.
            </li>
            {signIn}
          </Steps>
        </Way>
      ),
    },
    {
      id: "rclone",
      label: "Advanced",
      body: (
        <Way title="rclone">
          <p>Sync, back up or mount from any OS, and from scripts.</p>
          <code className={CODE}>
            {`rclone config create nimbus webdav url=${url} vendor=other user=${email} pass=$(rclone obscure 'APP-PASSWORD')\nrclone mount nimbus: ~/Nimbus --vfs-cache-mode writes\nrclone sync ~/Photos nimbus:Photos`}
          </code>
          <p>
            Run the mount as a service with <code>Restart=always</code> so it
            comes back after sleep. davfs2 can&apos;t list folders on Linux 7
            kernels.
          </p>
        </Way>
      ),
    },
  ]
}

const noop = () => () => {}

function detect() {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return "ios"
  if (/Android/.test(ua)) return "android"
  if (/Windows/.test(ua)) return "windows"
  if (/Macintosh/.test(ua)) return "mac"
  if (/Linux|X11/.test(ua)) return "linux"
}

function ConnectGuide({ url, email }: { url: string; email: string }) {
  const all = guides(url, email)
  // The visitor's own device, read after hydration so the server render matches.
  const os = useSyncExternalStore(noop, detect, () => undefined)
  const [picked, setTab] = useState<string>()
  const tab = picked ?? os ?? all[0].id
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm [&_code]:font-mono [&_code]:text-xs [&_code]:break-all">
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
        className="flex flex-col gap-5 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground"
      >
        {all.find((g) => g.id === tab)!.body}
      </div>
    </div>
  )
}
