"use client"

import { Dialog } from "@base-ui/react/dialog"
import { DownloadSimpleIcon } from "@phosphor-icons/react"
import { useId, useState } from "react"

import { snippets } from "@/components/buckets/connect"
import type { Made } from "@/components/buckets/key-dialog"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { CODE, RADIO, RADIO_INPUT, SELECT, TOUCH } from "@/components/registry-ui"
import { SaveToSecrets } from "@/components/registry-save-secret"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const CLIENTS = ["aws", "boto3", "rclone", "mc", "restic"]

function download(name: string, text: string, type: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Shown once after a key is made or its secret rotated. It can only be closed with Done, after "I've saved it".
export function KeyReveal({
  made,
  rotated,
  url,
  region,
  onDone,
}: {
  made: Made | null
  rotated?: boolean
  url: string
  region: string
  onDone: () => void
}) {
  const id = useId()
  const [client, setClient] = useState("aws")
  const [saved, setSaved] = useState(false)
  return (
    <Dialog.Root open={made !== null} onOpenChange={() => {}}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] max-w-xl overflow-y-auto")}>
          {made && (
            <Body
              made={made}
              rotated={rotated}
              url={url}
              region={region}
              client={client}
              setClient={setClient}
              saved={saved}
              setSaved={setSaved}
              id={id}
              onDone={() => {
                setSaved(false)
                onDone()
              }}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({
  made,
  rotated,
  url,
  region,
  client,
  setClient,
  saved,
  setSaved,
  id,
  onDone,
}: {
  made: Made
  rotated?: boolean
  url: string
  region: string
  client: string
  setClient: (c: string) => void
  saved: boolean
  setSaved: (s: boolean) => void
  id: string
  onDone: () => void
}) {
  const bucket = made.bucket ?? "my-bucket"
  const env = `AWS_ACCESS_KEY_ID=${made.accessKeyId}\nAWS_SECRET_ACCESS_KEY=${made.secret}\nAWS_ENDPOINT_URL=${url}\nAWS_DEFAULT_REGION=${region}\n`
  const csv = `Access key ID,Secret access key,Endpoint,Region\n${made.accessKeyId},${made.secret},${url},${region}\n`
  const config =
    client === "env" ? env : (snippets(url, region, bucket, made.accessKeyId, made.secret).find((s) => s.id === client)?.code ?? env)
  const file = made.name.replace(/[^\w.-]+/g, "-").toLowerCase() || "nimbus-s3"
  return (
    <>
      <div className="grid gap-1.5">
        <Dialog.Title className="text-base font-semibold">{rotated ? "Your new secret" : "Your new access key"}</Dialog.Title>
        <Dialog.Description className="text-sm text-pretty text-muted-foreground">
          Put both in the app now. The secret is shown only once; if you lose it, rotate the key again.
        </Dialog.Description>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        {(
          [
            ["Access key ID", made.accessKeyId],
            ["Secret access key", made.secret],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="grid min-w-0 gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            <div className="flex min-w-0 items-center gap-2">
              <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm select-all">{value}</code>
              <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} className="pointer-coarse:h-11" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`${id}-client`}>Config for</Label>
          <select id={`${id}-client`} value={client} onChange={(e) => setClient(e.target.value)} className={cn(SELECT, "pointer-coarse:h-11")}>
            {snippets(url, region, bucket)
              .filter((s) => CLIENTS.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            <option value="env">.env file</option>
          </select>
        </div>
        <div className="relative min-w-0">
          <code className={cn(CODE, "pt-12 sm:pr-20 sm:pt-3")} tabIndex={0}>
            {config}
          </code>
          <div className="absolute top-2 right-2">
            <CopyButton value={config} label="Copy config" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className={TOUCH} onClick={() => download(`${file}.env`, env, "text/plain")}>
          <DownloadSimpleIcon />
          Download .env
        </Button>
        <Button type="button" variant="outline" className={TOUCH} onClick={() => download(`${file}.csv`, csv, "text/csv")}>
          <DownloadSimpleIcon />
          Download .csv
        </Button>
      </div>
      <SaveToSecrets token={made.secret} s3={{ accessKeyId: made.accessKeyId }} />

      <label className={RADIO}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className={RADIO_INPUT} />
        <span className="font-medium">I&apos;ve saved the secret somewhere safe</span>
      </label>
      <div className="flex justify-end">
        <Button disabled={!saved} className={TOUCH} onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  )
}
