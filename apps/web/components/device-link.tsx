"use client"

import { CheckCircleIcon, DeviceMobileIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useState } from "react"
import { renderSVG } from "uqr"

import {
  answerDeviceLink,
  deviceLinkState,
  startDeviceLink,
} from "@/app/(app)/account/device-link-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Link = NonNullable<Awaited<ReturnType<typeof startDeviceLink>>>
type Asking = { deviceName: string | null; ip: string | null }

const isLocal = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]"

export function DeviceLink() {
  const [server, setServer] = useState("")
  const [link, setLink] = useState<Link | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [left, setLeft] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    setError(null)
    setDone(null)
    setAsking(null)
    const address = server || window.location.origin
    setServer(address)
    const next = await startDeviceLink(address)
    if (!next) setError("Sign-in with a code is turned off on this Nimbus.")
    setLink(next)
  }, [server])

  // Watches for a device claiming the code, and replaces the code when it runs
  // out, as long as nobody is waiting for an answer.
  useEffect(() => {
    if (!link || asking) return
    const tick = async () => {
      const ms = link.expiresAt - Date.now()
      setLeft(Math.max(0, Math.ceil(ms / 1000)))
      if (ms <= 0) {
        if (document.visibilityState === "visible") await start()
        else setLink(null)
        return
      }
      const state = await deviceLinkState(link.id)
      if (state?.status === "pending-approval")
        setAsking({ deviceName: state.deviceName, ip: state.ip })
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [link, asking, start])

  async function answer(allow: boolean) {
    if (!link) return
    const ok = await answerDeviceLink(link.id, allow)
    const name = asking?.deviceName ?? "That device"
    setLink(null)
    setAsking(null)
    if (!ok) setError("That request ran out of time. Try again.")
    else if (allow) setDone(`${name} is signing in.`)
    else setError(`${name} wasn't allowed to sign in.`)
  }

  if (asking)
    return (
      <div className="flex flex-col gap-4" role="alertdialog" aria-label="Approve this device">
        <div className="flex items-start gap-3">
          <DeviceMobileIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="grid gap-1 text-sm">
            <p className="font-medium">
              Allow {asking.deviceName ?? "this device"} to sign in to your
              account?
            </p>
            <p className="text-muted-foreground">
              {asking.ip ? `Requested from ${asking.ip}. ` : ""}It gets full
              access to your files. Only allow it if this is your device.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => answer(true)}>Allow</Button>
          <Button variant="outline" onClick={() => answer(false)}>
            Deny
          </Button>
        </div>
      </div>
    )

  if (!link)
    return (
      <div className="flex flex-col items-start gap-3">
        {done && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircleIcon className="size-4 text-brand" /> {done}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="outline" onClick={start}>
          Show QR code
        </Button>
      </div>
    )

  const local = isLocal(window.location.hostname)
  // A QR pointing at localhost would send the phone to itself, so don't show one.
  const qrHost = new URL(link.uri).searchParams.get("server") ?? ""
  const qrIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(qrHost)
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      {qrIsLocal ? (
        <div className="flex size-44 shrink-0 items-center justify-center rounded-lg border border-dashed border-input p-4 text-center text-sm text-muted-foreground">
          Enter an address your phone can reach to see the QR code.
        </div>
      ) : (
        <div
          role="img"
          aria-label="QR code to sign in on your phone"
          className="size-44 shrink-0 overflow-hidden rounded-lg bg-white p-2 [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: renderSVG(link.uri, { border: 0 }) }}
        />
      )}
      <div className="grid gap-3 text-sm">
        <p>
          In the Nimbus app, tap <strong>Scan QR code</strong>. Or choose{" "}
          <strong>Use a code</strong> and enter:
        </p>
        <dl className="grid gap-2">
          <div>
            <dt className="text-muted-foreground">Server</dt>
            <dd className="break-all">{qrIsLocal ? "Enter the address below" : server}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Code</dt>
            <dd className="font-mono text-lg tracking-wider">{link.code}</dd>
          </div>
        </dl>
        <p className="text-muted-foreground" aria-live="off">
          New code in {left}s. Each one works once.
        </p>
        {local && (
          <div className="grid gap-1.5">
            <Label htmlFor="link-server">Address your phone can reach</Label>
            <Input
              id="link-server"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="http://192.168.0.10:3000"
              onBlur={start}
            />
            <p className="text-muted-foreground">
              This page is open on localhost, which a phone can&apos;t reach. Use this computer&apos;s network address.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
