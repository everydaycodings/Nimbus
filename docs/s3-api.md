# Use Nimbus folders as S3 buckets

Nimbus has an optional S3-compatible API. It lets the AWS CLI, rclone, restic, Terraform, the AWS SDKs and backup tools use your Nimbus folders as S3 buckets. A bucket is an ordinary folder, so what a tool writes shows up in the web app, and what you upload on the web shows up in the bucket.

In the examples, `https://s3api.example.com` is the S3 API address, `my-bucket` is a bucket name and `NMS3...` is an access key ID.

## Overview

| Setting | Value |
|---|---|
| Endpoint | `https://<S3API_DOMAIN>`, for example `https://s3api.example.com` |
| Region | `us-east-1` |
| Addressing | Path-style (`https://s3api.example.com/my-bucket/key`) |
| Signature | AWS Signature Version 4 (header or presigned URL) |
| Credentials | An access key ID (`NMS3…`, 20 characters) and a secret access key (40 characters) |

## Turn it on (admins)

1. Run `setup.sh` and answer yes to "Turn on the S3-compatible API?". It adds the `s3api` profile, asks for a subdomain (default `s3api.<DOMAIN>`) and saves it as `S3API_DOMAIN` in `.env`. The subdomain must not be the same as the MinIO `S3_DOMAIN`.
2. Add a DNS A record for that subdomain pointing at this server.
3. Run `sudo production_script/setup-nginx.sh`. It serves the subdomain over HTTPS.

The `s3api` service listens on port 3407. Like WebDAV, it hands each request to the app as a signed request. See [install.md](install.md) and [configuration.md](configuration.md) for the rest of the setup.

In **Admin → System → S3 API** you can:

- Turn the API on or off for everyone ("Allow the S3 API"). While it is off, requests answer `503 ServiceUnavailable`.
- Set a limit of requests per second, per key. Requests over it answer `503 SlowDown`.
- See and revoke every member's access keys.

An admin can also turn the S3 API off for one member on their page under **Admin → Members**.

## Buckets

Open **S3 buckets** in the sidebar. You can make a bucket in two ways:

- **New bucket** makes a new folder under **S3 buckets** at the root of your files, or uses a folder you pick.
- **Use as S3 bucket** on a folder's menu turns that folder into a bucket.

A client can also make one with `CreateBucket` (for example `aws s3 mb`). It goes in the **S3 buckets** folder. **Stop using as bucket** turns a bucket back into a plain folder.

Bucket names follow S3's rules:

- 3 to 63 characters: lowercase letters, numbers, dots and hyphens.
- They start and end with a letter or number.
- No two dots in a row, and not shaped like an IP address.
- Names starting with `xn--` or ending with `-s3alias` are reserved.
- A name is unique per account and, like every name in Nimbus, case-insensitive.

Only the folder's owner can delete a bucket, and only when it is empty.

## Access keys

On the **S3 buckets** page, press **New access key**.

| Field | Choices |
|---|---|
| Name | Like `Backups` or `Laptop – rclone` |
| Access | Read & write (list, download, upload and delete) or Read only (list and download) |
| Buckets | All buckets, or the ones you pick |
| Expires | 30, 90 or 365 days, a date, or Never |

Copy the access key ID and the secret into the app right away. The secret is shown only once. If you lose it, revoke the key and make another.

Rules:

- Make one key per app, so you can revoke one without touching the others.
- Each member can have up to 50 access keys.
- A key limited to some buckets can still make a new bucket, and then gets access to it.
- After 20 failed signatures from one IP address, that address is blocked for 15 minutes.
- An expired key answers `ExpiredToken`. A key stops working when its account is disabled or has a temporary password.

## Supported operations

Anything not in this table answers `501 NotImplemented`. That includes ACLs, bucket policies, CORS, tagging, lifecycle rules, encryption settings, website hosting, logging, notifications, replication, object lock, retention, legal hold, `SelectObjectContent` and `RestoreObject`.

| Operation | Notes |
|---|---|
| `ListBuckets` | Buckets the key can reach |
| `CreateBucket` | Read & write keys only |
| `DeleteBucket` | Owner only, bucket must be empty |
| `HeadBucket` | |
| `GetBucketLocation` | Always `us-east-1` |
| `GetBucketVersioning` | Always `Enabled` |
| `PutBucketVersioning` | `Enabled` is accepted; `Suspended` is refused |
| `ListObjects`, `ListObjectsV2` | Prefix, delimiter, up to 1000 keys a page |
| `ListObjectVersions` | |
| `GetObject`, `HeadObject` | One byte range, `versionId`, `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since` |
| `PutObject` | Stores `Content-Type`, `x-amz-meta-*`, `Cache-Control`, `Content-Disposition`, `Content-Encoding`, `Content-Language`, `Expires` |
| `CopyObject` | |
| `DeleteObject` | With `versionId`, removes that version for good |
| `DeleteObjects` | 1 to 1000 keys a request |
| `CreateMultipartUpload` | |
| `UploadPart`, `UploadPartCopy` | Part numbers 1 to 10000 |
| `CompleteMultipartUpload` | |
| `AbortMultipartUpload` | |
| `ListParts`, `ListMultipartUploads` | Up to 1000 a page |

Also supported:

- Presigned URLs, for up to 7 days (604800 seconds).
- Streaming uploads (`aws-chunked`, signed or unsigned, with trailers).
- `x-amz-checksum-crc32`, `x-amz-checksum-sha1` and `x-amz-checksum-sha256` checks on upload.

Multipart uploads that are not finished after 7 days are aborted.

## AWS CLI

```sh
aws configure set aws_access_key_id NMS3...
aws configure set aws_secret_access_key ...
aws configure set region us-east-1

aws --endpoint-url https://s3api.example.com s3 ls
aws --endpoint-url https://s3api.example.com s3 ls s3://my-bucket
aws --endpoint-url https://s3api.example.com s3 cp ./report.pdf s3://my-bucket/reports/
aws --endpoint-url https://s3api.example.com s3 sync ./photos s3://my-bucket/photos
aws --endpoint-url https://s3api.example.com s3 presign s3://my-bucket/reports/report.pdf --expires-in 3600
```

## rclone

```sh
rclone config create nimbus s3 provider Other endpoint https://s3api.example.com \
  access_key_id NMS3... secret_access_key ... force_path_style true
rclone ls nimbus:my-bucket
rclone sync ~/Photos nimbus:my-bucket/Photos
```

## restic

```sh
export AWS_ACCESS_KEY_ID=NMS3...
export AWS_SECRET_ACCESS_KEY=...
restic -r s3:https://s3api.example.com/my-bucket init
restic -r s3:https://s3api.example.com/my-bucket backup ~/Documents
```

## Terraform backend

```hcl
terraform {
  backend "s3" {
    bucket                      = "my-bucket"
    key                         = "state/terraform.tfstate"
    region                      = "us-east-1"
    endpoints                   = { s3 = "https://s3api.example.com" }
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}
```

## AWS SDK for JavaScript

```js
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"

const s3 = new S3Client({
  endpoint: "https://s3api.example.com",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: "NMS3...", secretAccessKey: process.env.NIMBUS_S3_SECRET },
})

await s3.send(new PutObjectCommand({ Bucket: "my-bucket", Key: "hello.txt", Body: "Hello" }))
const r = await s3.send(new GetObjectCommand({ Bucket: "my-bucket", Key: "hello.txt" }))
console.log(await r.Body.transformToString())
```

Other SDKs work the same way: set the endpoint, region `us-east-1` and path-style addressing.

## Limits

- Deletes move files to the trash, as on the web.
- Versioning is always on and can't be suspended. Every overwrite keeps the old version.
- Vault folders can't be buckets.
- Uploads follow the server's upload rules and your storage quota. A file over the limit answers `EntityTooLarge`.
- Only path-style addressing works. Set `force_path_style`, `use_path_style` or `forcePathStyle` in your tool.
- To keep secrets like the access key out of code, store them in Nimbus Secrets ([secrets.md](secrets.md)).
