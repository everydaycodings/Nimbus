"use client"

import { useId, useState } from "react"

import { BucketSelect, type Opt } from "@/components/buckets/bucket-picker"
import { CopyButton } from "@/components/copy-button"
import { Heading, SECTION } from "@/components/registry-ui"

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

export function Connect({
  url,
  region,
  buckets,
}: {
  url: string
  region: string
  buckets: Opt[]
}) {
  const [tab, setTab] = useState("aws")
  const [bucket, setBucket] = useState("")
  const id = useId()
  const name = buckets.some((b) => b.name === bucket) ? bucket : (buckets[0]?.name ?? "my-bucket")
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
              <BucketSelect label="Bucket" buckets={buckets} value={name} onChange={setBucket} />
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
