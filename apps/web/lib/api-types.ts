// Compile-time check that @nimbus/shared/api still matches what the services
// return. Nothing runs; `tsc` fails here when one side drifts.
import type * as Api from "@nimbus/shared/api"

import type { Item, Hit, Tag } from "@/lib/files"
import type { Notification } from "@/lib/notify"
import type { Usage } from "@/lib/quota"
import type * as Files from "@/lib/services/files"
import type * as Shares from "@/lib/services/shares"
import type * as Sync from "@/lib/services/sync"
import type * as Uploads from "@/lib/services/uploads"
import type * as Vault from "@/lib/services/vault"
import type { Report } from "@/lib/storage-report"
import type { VaultSummary } from "@/lib/vault"

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

export type Checks = [
  Assert<Same<Api.Item, Item>>,
  Assert<Same<Api.Hit, Hit>>,
  Assert<Same<Api.Tag, Tag>>,
  Assert<Same<Api.Notification, Notification>>,
  Assert<Same<Api.Usage, Usage>>,
  Assert<Same<Api.Details, Files.Details>>,
  Assert<Same<Api.TagSnapshot, Files.TagSnapshot>>,
  Assert<Same<Api.ShareState, Shares.ShareState>>,
  Assert<Same<Api.Person, Shares.Person>>,
  Assert<Same<Api.LinkInfo, Shares.LinkInfo>>,
  Assert<Same<Api.LinkEvent, Shares.LinkEvent>>,
  Assert<Same<Api.Version, Uploads.Version>>,
  Assert<Same<Api.Plan, Uploads.Plan>>,
  Assert<Same<Api.UploadEntry, Uploads.UploadEntry>>,
  Assert<Same<Api.Conflict, Uploads.Conflict>>,
  Assert<Same<Api.ZipManifest, Uploads.ZipManifest>>,
  Assert<Same<Api.ExistsQuery, Uploads.ExistsQuery>>,
  Assert<Same<Api.ExistsMatch, Uploads.ExistsMatch>>,
  Assert<Same<Api.TreeEntry, Sync.TreeEntry>>,
  Assert<Same<Api.TreeResponse, Sync.TreeResponse>>,
  Assert<Same<Api.VaultNode, Vault.VaultNode>>,
  Assert<Same<Api.VaultKeys, Vault.VaultKeys>>,
  Assert<Same<Api.VaultSummary, VaultSummary>>,
  // The service's rows are narrower (trash rows have parentId null).
  Assert<[Report] extends [Api.StorageReport] ? true : false>,
]
