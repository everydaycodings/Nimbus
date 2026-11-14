"use client"

import { Dialog } from "@base-ui/react/dialog"
import { CubeIcon, KeyIcon, PlusIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useId, useState, useTransition } from "react"

import {
  createKey,
  revokeKey,
  setQuiet,
  unmarkBucket,
} from "@/app/(app)/buckets/actions"
import { BucketDialog, QUIET_HINT } from "@/components/s3-bucket-dialog"
import { CopyButton } from "@/components/copy-button"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatBytes } from "@/lib/file-types"
import type { BucketRow, KeyRow } from "@/lib/s3api/manage"
import { cn } from "@/lib/utils"

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
const WHEN = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const ACCESS = { rw: "Read & write", ro: "Read only" }
const EXPIRY = [
  ["never", "Never"],
  ["30", "In 30 days"],
  ["90", "In 90 days"],
  ["365", "In a year"],
  ["date", "On a date…"],
]
const SECTION = "flex flex-col gap-3"
const LIST = "divide-y overflow-hidden rounded-xl border bg-card"

function Heading({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="mr-auto grid min-w-0 gap-1">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CubeIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">{children}</p>
    </div>
  )
}

// Confirms inline, like the other lists: the button turns into "Sure? Yes / No".
function Confirm({
  label,
  question,
  yes,
  pending,
  onYes,
}: {
  label: string
  question: string
  yes: string
  pending: boolean
  onYes: () => void
}) {
  const [sure, setSure] = useState(false)
  if (!sure)
    return (
      <Button variant="outline" size="sm" onClick={() => setSure(true)}>
        {label}
      </Button>
    )
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{question}</span>
      <Button variant="destructive" size="sm" disabled={pending} onClick={onYes}>
        {yes}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        autoFocus
        disabled={pending}
        onClick={() => setSure(false)}
      >
        Keep
      </Button>
    </span>
  )
}

export function BucketsView({
  buckets,
  keys,
  url,
  region,
  maxKeys,
}: {
  buckets: BucketRow[]
  keys: KeyRow[]
  url: string
  region: string
  maxKeys: number
}) {
  const [newBucket, setNewBucket] = useState(false)
  const [newKey, setNewKey] = useState(false)
  const setNotice = useNotice()
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">S3 buckets</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Let tools like the AWS CLI, rclone, restic and Terraform use your folders as S3 buckets.
          Files stay ordinary Nimbus files with versions, trash and sharing.
        </p>
      </header>

      <section className={SECTION} aria-labelledby="buckets-heading">
        <Heading
          id="buckets-heading"
          title="Buckets"
          hint="Folders apps can reach. Mark any folder from its ⋯ menu, or make one here."
        >
          <Button onClick={() => setNewBucket(true)}>
            <PlusIcon />
            New bucket
          </Button>
        </Heading>
        {buckets.length === 0 ? (
          <Empty icon={CubeIcon} title="No buckets yet">
            A bucket is a folder S3 apps can read and write. Make one, then create an access key.
          </Empty>
        ) : (
          <ul className={LIST}>
            {buckets.map((b) => (
              <BucketItem key={b.id} b={b} />
            ))}
          </ul>
        )}
      </section>

      <section className={SECTION} aria-labelledby="keys-heading">
        <Heading
          id="keys-heading"
          title="Access keys"
          hint={`Apps sign in with a key, never your password or two-factor. Make one per app so you can revoke it alone. ${keys.length} of ${maxKeys} used.`}
        >
          <Button onClick={() => setNewKey(true)} disabled={keys.length >= maxKeys}>
            <PlusIcon />
            New access key
          </Button>
        </Heading>
        {keys.length === 0 ? (
          <Empty icon={KeyIcon} title="No access keys yet">
            Make a key to connect an app. You see its secret once, right after it&apos;s made.
          </Empty>
        ) : (
          <ul className={LIST}>
            {keys.map((k) => (
              <KeyItem key={k.id} k={k} />
            ))}
          </ul>
        )}
      </section>

      <Connect url={url} region={region} buckets={buckets.map((b) => b.name)} />

      <BucketDialog
        open={newBucket}
        onClose={() => setNewBucket(false)}
        onDone={(name) => {
          setNewBucket(false)
          setNotice({ text: `“${name}” is now an S3 bucket.` })
        }}
      />
      <NewKey open={newKey} buckets={buckets} onClose={() => setNewKey(false)} />
    </div>
  )
}

function BucketItem({ b }: { b: BucketRow }) {
  const [pending, start] = useTransition()
  const [quiet, setLocal] = useState(b.quiet)
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  const id = useId()
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 gap-0.5 basis-56">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="font-mono break-all">{b.name}</span>
            {b.role === "viewer" && <Badge variant="outline">Read only</Badge>}
            {b.gone && <Badge variant="secondary">Hidden</Badge>}
          </p>
          <p className="text-xs text-pretty text-muted-foreground">
            {b.gone ? (
              <>
                {b.path} · {b.role === "owner" ? "In the trash" : "No longer shared with you"}. Apps
                can&apos;t see this bucket.
              </>
            ) : (
              <>
                <Link
                  href={`/folders/${b.nodeId}`}
                  className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {b.path}
                </Link>
                {b.owner && ` · Shared by ${b.owner}`} ·{" "}
                <span className="tabular-nums">{formatBytes(b.bytes)}</span>
              </>
            )}
          </p>
        </div>
        <label
          htmlFor={id}
          title={QUIET_HINT}
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={quiet}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.checked
              setLocal(next)
              setError(undefined)
              start(async () => {
                const r = await setQuiet(b.id, next)
                if (r.error) {
                  setLocal(!next)
                  setError(r.error)
                }
              })
            }}
            className="size-4 accent-primary"
          />
          Quiet
        </label>
        <Confirm
          label="Stop using as bucket"
          question="Files stay. Apps lose this bucket."
          yes="Stop"
          pending={pending}
          onYes={() =>
            start(async () => {
              const r = await unmarkBucket(b.id)
              if (r.error) return setError(r.error)
              setNotice({ text: `“${b.name}” is a normal folder again.` })
            })
          }
        />
      </div>
      <FormError>{error}</FormError>
    </li>
  )
}

function KeyItem({ k }: { k: KeyRow }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const setNotice = useNotice()
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 gap-1 basis-64">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="min-w-0 break-words">{k.name}</span>
            <Badge variant="outline">{ACCESS[k.access]}</Badge>
            {k.expired && <Badge variant="secondary">Expired</Badge>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <code className="rounded bg-input/20 px-1.5 py-0.5 font-mono text-foreground select-all">
              {k.accessKeyId}
            </code>
            <span className="min-w-0 break-words">
              {k.allBuckets
                ? "All buckets"
                : k.buckets.length
                  ? k.buckets.join(", ")
                  : "No buckets left"}
            </span>
          </p>
          <p
            suppressHydrationWarning
            className="text-xs text-pretty break-words text-muted-foreground"
          >
            {k.expiresAt
              ? `${k.expired ? "Expired" : "Expires"} ${DAY.format(new Date(k.expiresAt))}`
              : "Never expires"}{" "}
            · Created {DAY.format(new Date(k.createdAt))} ·{" "}
            {k.lastUsedAt
              ? `Last used ${WHEN.format(new Date(k.lastUsedAt))}${k.lastIp ? ` from ${k.lastIp}` : ""}`
              : "Never used"}
          </p>
        </div>
        <Confirm
          label="Revoke"
          question="Apps using it stop at once."
          yes="Revoke"
          pending={pending}
          onYes={() =>
            start(async () => {
              const r = await revokeKey(k.id)
              if (r.error) return setError(r.error)
              setNotice({ text: `Revoked “${k.name}”.` })
            })
          }
        />
      </div>
      <FormError>{error}</FormError>
    </li>
  )
}

const RADIO =
  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-ring/60 has-checked:bg-input/30"

function NewKey({
  open,
  buckets,
  onClose,
}: {
  open: boolean
  buckets: BucketRow[]
  onClose: () => void
}) {
  const [made, setMade] = useState<{ accessKeyId: string; secret: string }>()
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(true)
  const [chosen, setChosen] = useState<string[]>([])
  const [expiry, setExpiry] = useState("never")
  const [pending, start] = useTransition()
  const id = useId()
  const [tomorrow] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))

  const close = () => {
    onClose()
    // After the dialog fades out.
    setTimeout(() => {
      setMade(undefined)
      setError(null)
      setAll(true)
      setChosen([])
      setExpiry("never")
    }, 200)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100svh-2rem)] overflow-y-auto")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              {made ? "Your new access key" : "New access key"}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-pretty text-muted-foreground">
              {made
                ? "Put both in the app now. The secret is shown only once; if you lose it, revoke the key and make another."
                : "One per app. Pick what it can reach and when it stops working."}
            </Dialog.Description>
          </div>
          {made ? (
            <>
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
                      <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm select-all">
                        {value}
                      </code>
                      <CopyButton value={value} />
                    </div>
                  </div>
                ))}
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
                  const r = await createKey({
                    name: String(f.get("name") ?? ""),
                    access: String(f.get("access") ?? ""),
                    allBuckets: all,
                    bucketIds: chosen,
                    expiry: expiry === "date" ? String(f.get("date") ?? "") : expiry,
                  })
                  if (r.error || !r.secret) return setError(r.error ?? "Couldn't make the key.")
                  setMade({ accessKeyId: r.accessKeyId!, secret: r.secret })
                })
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input
                  id={`${id}-name`}
                  name="name"
                  maxLength={60}
                  placeholder="Laptop – rclone"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Access</legend>
                {(
                  [
                    ["rw", "Read & write", "List, download, upload and delete."],
                    ["ro", "Read only", "List and download, nothing else."],
                  ] as const
                ).map(([value, label, hint], i) => (
                  <label key={value} className={RADIO}>
                    <input
                      type="radio"
                      name="access"
                      value={value}
                      defaultChecked={i === 0}
                      className="size-4 accent-primary"
                    />
                    <span className="grid">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Buckets</legend>
                <label className={RADIO}>
                  <input
                    type="radio"
                    name="scope"
                    checked={all}
                    onChange={() => setAll(true)}
                    className="size-4 accent-primary"
                  />
                  <span className="grid">
                    <span className="font-medium">All buckets</span>
                    <span className="text-xs text-muted-foreground">Including ones you make later.</span>
                  </span>
                </label>
                <label className={cn(RADIO, !buckets.length && "cursor-not-allowed opacity-60")}>
                  <input
                    type="radio"
                    name="scope"
                    checked={!all}
                    disabled={!buckets.length}
                    onChange={() => setAll(false)}
                    className="size-4 accent-primary"
                  />
                  <span className="grid">
                    <span className="font-medium">Only some buckets</span>
                    <span className="text-xs text-muted-foreground">
                      {buckets.length ? "Pick which." : "Make a bucket first."}
                    </span>
                  </span>
                </label>
                {!all && (
                  <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1">
                    {buckets.map((b) => (
                      <li key={b.id}>
                        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50">
                          <input
                            type="checkbox"
                            checked={chosen.includes(b.id)}
                            onChange={(e) =>
                              setChosen(
                                e.target.checked ? [...chosen, b.id] : chosen.filter((c) => c !== b.id)
                              )
                            }
                            className="size-4 accent-primary"
                          />
                          <span className="truncate font-mono">{b.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-expiry`}>Expires</Label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id={`${id}-expiry`}
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {EXPIRY.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {expiry === "date" && (
                    <Input
                      name="date"
                      type="date"
                      aria-label="Expiry date"
                      min={tomorrow}
                      required
                      className="w-auto flex-1"
                    />
                  )}
                </div>
              </div>
              <FormError>{error}</FormError>
              <div className="flex justify-end gap-2">
                <Dialog.Close disabled={pending} render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <SubmitButton pending={pending}>Create key</SubmitButton>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const CODE = "block overflow-x-auto rounded-lg bg-input/20 p-3 pt-12 font-mono sm:pt-3 sm:pr-20 text-xs leading-relaxed whitespace-pre"

function snippets(url: string, region: string, bucket: string) {
  const host = url.replace(/^https?:\/\//, "")
  const ID = "YOUR_ACCESS_KEY_ID"
  const SECRET = "YOUR_SECRET_ACCESS_KEY"
  return [
    {
      id: "aws",
      label: "AWS CLI",
      code: `# ~/.aws/credentials
[nimbus]
aws_access_key_id = ${ID}
aws_secret_access_key = ${SECRET}

# ~/.aws/config
[profile nimbus]
region = ${region}
endpoint_url = ${url}
s3 =
  addressing_style = path

aws --profile nimbus s3 ls
aws --profile nimbus s3 cp ./notes.txt s3://${bucket}/
aws --profile nimbus s3 sync ./photos s3://${bucket}/photos`,
    },
    {
      id: "rclone",
      label: "rclone",
      code: `# ~/.config/rclone/rclone.conf
[nimbus]
type = s3
provider = Other
access_key_id = ${ID}
secret_access_key = ${SECRET}
endpoint = ${url}
region = ${region}
force_path_style = true

rclone lsd nimbus:
rclone sync ./photos nimbus:${bucket}/photos`,
    },
    {
      id: "restic",
      label: "restic",
      code: `export AWS_ACCESS_KEY_ID=${ID}
export AWS_SECRET_ACCESS_KEY=${SECRET}

restic -r s3:${url}/${bucket} init
restic -r s3:${url}/${bucket} backup ~/Documents`,
    },
    {
      id: "terraform",
      label: "Terraform",
      code: `# Needs Terraform 1.11 or newer. Set AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY in the environment.
terraform {
  backend "s3" {
    bucket = "${bucket}"
    key    = "state/terraform.tfstate"
    region = "${region}"

    endpoints = {
      s3 = "${url}"
    }
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}`,
    },
    {
      id: "boto3",
      label: "Python (boto3)",
      code: `import boto3
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url="${url}",
    region_name="${region}",
    aws_access_key_id="${ID}",
    aws_secret_access_key="${SECRET}",
    config=Config(s3={"addressing_style": "path"}),
)
print(s3.list_objects_v2(Bucket="${bucket}").get("Contents", []))`,
    },
    {
      id: "other",
      label: "Other apps",
      code: `Endpoint   ${url}
Host       ${host}
Region     ${region}
Style      Path-style (not virtual-hosted)
Bucket     ${bucket}
Access key ${ID}
Secret     ${SECRET}`,
    },
  ]
}

function Connect({
  url,
  region,
  buckets,
}: {
  url: string
  region: string
  buckets: string[]
}) {
  const [tab, setTab] = useState("aws")
  const [bucket, setBucket] = useState("")
  const id = useId()
  const name = bucket && buckets.includes(bucket) ? bucket : (buckets[0] ?? "my-bucket")
  const all = snippets(url, region, name)
  const shown = all.find((s) => s.id === tab)!
  return (
    <section className={SECTION} aria-labelledby="connect-heading">
      <Heading
        id="connect-heading"
        title="Connect an app"
        hint="Use this address and an access key. Nimbus only speaks path-style, and any region name works."
      />
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <dl className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <div className="grid gap-1.5">
            <dt className="text-sm font-medium">Endpoint</dt>
            <dd className="flex items-center gap-2">
              <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm select-all">
                {url}
              </code>
              <CopyButton value={url} />
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <div className="grid min-w-0 gap-1.5">
              <dt className="text-sm font-medium">Region</dt>
              <dd className="flex h-9 items-center overflow-x-auto rounded-md border bg-input/20 px-3 font-mono text-sm">
                {region}
              </dd>
            </div>
            <div className="grid gap-1.5">
              <dt className="text-sm font-medium">Addressing</dt>
              <dd className="flex h-9 items-center text-sm text-muted-foreground">Path-style</dd>
            </div>
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div
            role="tablist"
            aria-label="Clients"
            className="flex flex-wrap gap-1"
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
              if (!step) return
              e.preventDefault()
              const next = all[(all.findIndex((s) => s.id === tab) + step + all.length) % all.length]
              setTab(next.id)
              document.getElementById(`${id}-${next.id}`)?.focus()
            }}
          >
            {all.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`${id}-${s.id}`}
                aria-selected={tab === s.id}
                tabIndex={tab === s.id ? 0 : -1}
                aria-controls={`${id}-panel`}
                onClick={() => setTab(s.id)}
                className="rounded-md px-2.5 py-1 text-sm text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-accent aria-selected:text-foreground"
              >
                {s.label}
              </button>
            ))}
          </div>
          {buckets.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Bucket
              <select
                value={name}
                onChange={(e) => setBucket(e.target.value)}
                className="h-8 max-w-48 rounded-md border border-input bg-input/20 px-2 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {buckets.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${shown.id}`}
          className="relative"
        >
          <code className={CODE}>{shown.code}</code>
          <div className="absolute top-2 right-2">
            <CopyButton value={shown.code} />
          </div>
        </div>
      </div>
    </section>
  )
}
