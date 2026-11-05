// Types for the private /api/v1 that the Android app calls. Plain types only,
// no runtime imports, so the app can use it as `@nimbus/shared/api`.
// Routes and bodies are listed in apps/web/app/api/v1/README.md.
// Dates are ISO 8601 strings. Sizes are bytes.

// ---- Basics ----

/** Every non-2xx answer. `error` is a stable code, `message` is plain language to show. */
export type ApiError = {
  error:
    | "signed-out" // 401: no or expired token
    | "gated" // 403: account must finish a step first, see GET /me `gate`
    | "bad-request" // 400: malformed input
    | "refused" // 400: understood, but not allowed or not possible
    | "forbidden" // 403: not yours to change
    | "not-found" // 404: gone, or you can't see it
    | (string & {})
  message: string
}

/** Many mutations answer 200 with this when there's nothing else to say. */
export type Empty = Record<string, never>
export type Role = "owner" | "editor" | "viewer"
export type TagColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "teal"
  | "indigo"
  | "brown"
  | "gray"

export type Gate =
  | "temporary-password"
  | "confirm-email"
  | "pending"
  | "rejected"
  | "two-factor"

export type Tag = { id: string; name: string; color: TagColor }

// ---- Public: GET /instance ----

export type Instance = {
  app: "nimbus"
  apiVersion: number
  providers: {
    google: boolean
    github: boolean
    oidc: { name: string } | null
    /** Only the one OIDC provider is offered. */
    only: boolean
  }
  signupMode: "approval" | "invite" | "open" | "closed"
  /** Sign-in by QR or short code from the web's Account page. */
  deviceLinks: boolean
  passwordPolicy: {
    min: number
    lower: boolean
    upper: boolean
    digit: boolean
    symbol: boolean
    exclude: string
  } | null
  email: boolean
  /** The tus endpoint to upload to. */
  tusUrl: string
  /** null: no limit. */
  maxUploadBytes: number | null
  blockedExtensions: string[]
}

// ---- GET /me ----

export type Usage = {
  used: number
  /** null: no limit. */
  quota: number | null
  images: number
  videos: number
  docs: number
  other: number
  vault: number
  /** Older versions and trashed files. */
  extra: number
}

export type Me = {
  id: string
  name: string
  email: string
  image: string | null
  role: "owner" | "admin" | "member"
  canAdmin: boolean
  twoFactor: boolean
  hasPassword: boolean
  vaultsEnabled: boolean
  /** The step this account must finish first, or null. */
  gate: Gate | null
  usage: Usage | null
  /** The upload speed cap in bytes a second, which clients keep to; null: none. Missing on older servers. */
  uploadSpeedBytes?: number | null
}

// ---- Items and lists ----

export type Item = {
  id: string
  kind: "file" | "folder"
  name: string
  size: number
  mime: string | null
  starred: boolean
  updatedAt: string
  trashedAt: string | null
  /** Ids of my own tags on it. */
  tags: string[]
  /** Set on items in the shared-with-me list. */
  owner?: string
  ownerImage?: string | null
  /** Current version id; thumbnails and previews are per version. */
  version: string | null
  /** Thumbnail revision: null until one is made, "" when it couldn't be. */
  thumb: string | null
  /** Present when the item isn't mine. */
  role?: "editor" | "viewer"
  sharedWithPeople: boolean
  hasLink: boolean
  /** A shortcut in My files to something shared with me. */
  shortcut?: boolean
  /** Its current version's text is in the search index. */
  indexed?: boolean
}

export type TypeKey =
  | "folder"
  | "image"
  | "video"
  | "doc"
  | "pdf"
  | "audio"
  | "code"
  | "archive"
  | "other"

/** Query for every list route (files, folders/{id}, recent, starred, shared, trash, tags/{id}, search). */
export type ListQuery = {
  type?: TypeKey
  modified?: "today" | "week" | "month" | "year"
  /** small < 1 MB, medium 1 to 100 MB, large 100 MB to 1 GB, huge > 1 GB. */
  size?: "small" | "medium" | "large" | "huge"
  tag?: string
  /** "rank" keeps the server's order (recent, search relevance). */
  sort?: "rank" | "name" | "date" | "size"
  /** Default: asc for name, desc for date and size. */
  order?: "asc" | "desc"
  /** 1 to 1000, default 500. */
  limit?: number
  /** `nextCursor` from the previous page. */
  cursor?: number | string
}

export type ListResponse<T extends Item = Item> = {
  items: T[]
  /** Items matching the filters, across all pages. */
  total: number
  nextCursor: string | null
  /** My tags, for filter chips. */
  tags: Tag[]
}

export type PathStep = { id: string; name: string }

export type FolderResponse = ListResponse & {
  folder: { id: string; name: string; role: Role; ownerId: string }
  /** Root first, as far as I may see; ends with the folder itself. */
  path: PathStep[]
}
export type TrashResponse = ListResponse & { retentionDays: number | null }
export type TagResponse = ListResponse & { tag: Tag; count: number }

export type Hit = Item & {
  /** The folder it's in as I know it, "My files" or "Shared with me". */
  where: string
  byName: boolean
  /** Text around the match, with \u0001 and \u0002 around the matched words. */
  snippet: string | null
}
export type SearchResponse = ListResponse<Hit>
export type QuickSearchResponse = { items: Hit[] }
export type OcrLangsResponse = { langs: string }
export type SaveContentRequest = {
  versionId: string
  body: string
  source: "text" | "pdf" | "docx" | "sheet" | "pptx" | "ocr"
}

export type ItemResponse = { item: Item | null; details: Details }
export type Details = {
  owner: string
  createdAt: string
  /** null inside someone else's folder where the path isn't mine to see. */
  location: string[] | null
  role: Role
  contents: { folders: number; files: number; bytes: number } | null
  /** Number of shares; null unless I own it. */
  shares: number | null
}

// ---- File operations ----

export type CreateFolderRequest = { parentId: string | null; name: string }
export type CreateFolderResponse = { id: string }
export type RenameRequest = { name: string }
export type MoveRequest = { ids: string[]; parentId: string | null }
export type StarRequest = { ids: string[]; starred: boolean }
export type IdsRequest = { ids: string[] }
export type PickerResponse = { folders: { id: string; name: string }[] }
export type ShortcutRequest = { nodeId: string }

// ---- Tags ----

export type TagsResponse = { tags: Tag[] }
export type CreateTagRequest = {
  name: string
  color: TagColor
  applyTo?: string[]
}
export type CreateTagResponse = { tag?: Tag }
export type UpdateTagRequest = { name?: string; color?: TagColor }
/** `merge` set: another tag has that name; ask, then POST /tags/{id}/merge. */
export type UpdateTagResponse = { merge?: string }
export type MergeTagRequest = { into: string }
export type TagSnapshot = { tag: Tag; nodeIds: string[] }
export type ApplyTagRequest = { ids: string[]; tagId: string; on: boolean }

// ---- Versions ----

export type Version = {
  id: string
  /** v1, v2, … in upload order. */
  number: number
  size: number
  mime: string | null
  createdAt: string
  /** Display name of the uploader. */
  uploadedBy: string | null
  note: string | null
  keep: boolean
  current: boolean
}
export type VersionsResponse = { versions: Version[] }
export type DeleteOlderResponse = { count: number }
export type UpdateVersionRequest = { note?: string; keep?: boolean }
export type CopyVersionResponse = { name: string }

// ---- Uploads ----

export type UploadEntry = {
  /** Relative to the target folder, "/"-separated: "a.jpg" or "Photos/2024/a.jpg". */
  path: string
  size: number
  /** An empty folder from a folder upload. */
  dir?: boolean
}
export type PlanUploadRequest = {
  parentId: string | null
  entries: UploadEntry[]
}
export type Conflict = {
  path: string
  kind: "file" | "folder"
  /** Name for "Keep both", e.g. "a (1).jpg" or "Photos (1)". */
  freeName: string
}
/**
 * `error` set (HTTP 200): nothing is planned, show it. Otherwise `token` goes
 * into the tus metadata and `rejected` entries must not be sent.
 */
export type Plan = {
  error?: string
  token?: string
  conflicts: Conflict[]
  rejected: { path: string; reason: string }[]
}
export type CreateFoldersRequest = { parentId: string | null; paths: string[] }
export type FinishUploadRequest = {
  /** The tus Location URL, or its last path segment as `uploadId`. */
  uploadUrl?: string
  uploadId?: string
  sha256?: string | null
}
export type FinishUploadResponse = {
  nodeId?: string
  versionId?: string
  /** Same bytes already in my files elsewhere (only when sha256 was sent). */
  duplicateOf?: { id: string; path: string }
}
export type ExistsQuery = {
  /** Lowercase hex SHA-256. Matches only files finished with a sha256. */
  sha256?: string
  /** With `name` (and `parentId`, null/omitted: My files): a file of that name. */
  name?: string
  size?: number
  parentId?: string | null
}
export type ExistsMatch = {
  id: string
  path: string
  by: "sha256" | "name"
  /** `name` matches only. */
  sameSize?: boolean
}
export type ExistsRequest = { items: ExistsQuery[] }
export type ExistsResponse = { matches: (ExistsMatch | null)[] }

/**
 * Metadata for a normal (non-Vault) tus upload. Send as tus `Upload-Metadata`.
 * `onConflict`: "version" makes it a new version of the same-named file there;
 * anything else (use "rename") keeps both under a free name. To skip a file,
 * don't upload it. To keep both for a folder, replace the folder's name in
 * `path` with the conflict's `freeName`.
 */
export type TusMetadata = {
  filename: string
  filetype: string
  token: string
  path: string
  onConflict: "version" | "rename"
}
/** Metadata for a Vault tus upload; `filename`, `nameTag` and `encKey` are sealed. */
export type VaultTusMetadata = {
  filename: string
  nameTag: string
  token: string
  encKey: string
  /** Vault node id this replaces. */
  replaces?: string
}

export type ZipManifest = {
  name: string
  entries: { path: string; url: string; size: number; modified: string }[]
  /** Empty folders, so the zip keeps the tree. */
  dirs: string[]
}

// ---- Previews ----

export type PreviewResponse = { url: string }
/** POST `access_token=<token>&access_token_ttl=0` as a form into a WebView at `action`. */
export type OfficeResponse = {
  office: { action: string; token: string } | null
}

// ---- Sharing ----

export type Person = {
  shareId: string
  userId: string | null
  name: string
  email: string
  image: string | null
  role: "viewer" | "editor"
  /** An email invite for someone without an account yet. */
  invited: boolean
  /** Name of the folder above that gives them access, if inherited. */
  through: string | null
  canManage: boolean
}
export type LinkInfo = {
  id: string
  token: string
  name: string
  expiresAt: string | null
  hasPassword: boolean
  allowView: boolean
  allowDownload: boolean
  allowUpload: boolean
  uploadCapBytes: number | null
  viewCount: number
  downloadCount: number
  lastOpenedAt: string | null
  canManage: boolean
}
export type ShareState = {
  name: string
  kind: "file" | "folder"
  isOwner: boolean
  owner: { name: string; email: string; image: string | null }
  people: Person[]
  links: LinkInfo[]
  allowReshare: boolean
  /** The admin allows public links. */
  publicLinks: boolean
  maxLinkDays: number | null
  requireLinkPassword: boolean
  /** Email invites need sign-ups to be possible. */
  canInvite: boolean
  emailOn: boolean
  transferTo: { name: string; email: string } | null
}
export type Member = {
  id: string
  name: string
  email: string
  image: string | null
}
export type MembersResponse = { members: Member[] }
export type ShareWithRequest = {
  /** A member's user id, or an email address. */
  target: string
  role: "viewer" | "editor"
}
export type ReshareRequest = { allowReshare: boolean }
export type SetShareRoleRequest = { role: "viewer" | "editor" }
export type CreateLinkRequest = { name?: string; password?: string }
export type CreateLinkResponse = { id: string }
export type UpdateLinkRequest = {
  name?: string
  /** ISO date; null removes it. */
  expiresAt?: string | null
  /** "" removes the password. */
  password?: string
  allowView?: boolean
  allowDownload?: boolean
  allowUpload?: boolean
  uploadCapBytes?: number | null
}
export type LinkEvent = {
  kind: string
  ip: string | null
  ua: string | null
  detail: string | null
  at: string
}
export type LinkEventsResponse = { events: LinkEvent[] }
export type OfferOwnershipRequest = { to: string }
export type AnswerOwnershipRequest = { accept: boolean }

// ---- Notifications ----

export type NotificationKind =
  | "shared"
  | "access_changed"
  | "access_removed"
  | "file_drop"
  | "edits"
  | "transfer"
  | "signup_request"
  | "service_health"
  | "backup"
  | "app_password"
  | "storage_low"
export type Notification = {
  id: string
  kind: NotificationKind
  text: string
  /** A web path. */
  href: string
  read: boolean
  createdAt: string
  nodeId: string | null
  /** An ownership transfer still waiting for my answer. */
  pending: boolean
}
export type NotificationsResponse = {
  items: Notification[]
  unread: number
  /** How many unread ones are new shares. */
  shared: number
}
export type MarkReadRequest = { ids?: string[] }

// ---- Account ----

export type NotificationPref = {
  kind: NotificationKind
  email: boolean
  bell: boolean
}
export type AppPassword = {
  id: string
  name: string
  scope: "rw" | "ro"
  lastFour: string
  createdAt: string
  lastUsedAt: string | null
  lastIp: string | null
}
export type AccountResponse = {
  profile: {
    id: string
    name: string
    email: string
    image: string | null
    emailVerified: boolean
  }
  /** "credential", "google", "github", or the OIDC provider's id. */
  linkedProviders: string[]
  hasPassword: boolean
  twoFactor: boolean
  /** The admin requires two-factor, so it can't be turned off. */
  require2fa: boolean
  /** The address app passwords sign in to. */
  webdavUrl: string
  notificationPrefs: NotificationPref[]
  vaultLockMinutes: number
  appPasswordsEnabled: boolean
  appPasswords: AppPassword[]
}
export type ChangePasswordRequest = { current: string; next: string }
export type OkResponse = { ok: true }
export type NotificationPrefsRequest = {
  prefs: Partial<Record<NotificationKind, { email: boolean; bell: boolean }>>
}
export type VaultLockRequest = { minutes: 5 | 15 | 30 | 60 }
export type AvatarsResponse = {
  /** Paths on this server, e.g. "/avatars/03.webp". */
  presets: string[]
  /** The photo kept from sign-up, or null. */
  provider: string | null
  current: string | null
}
/** A preset path from `presets`, or "provider". */
export type PickAvatarRequest = { choice: string }
export type CreateAppPasswordRequest = { name: string; scope: "rw" | "ro" }
/** The only time the password is shown. */
export type CreateAppPasswordResponse = { password: string }

// ---- Storage ----

export type ReportRow = {
  id: string
  kind: "file" | "folder"
  name: string
  mime: string | null
  size: number
  parentId: string | null
  /** The folder it's in, "" at the top. */
  where: string
  /** Old versions only. */
  versions?: number
  keep?: number
}
export type StorageReport = {
  usage: Usage
  largest: ReportRow[]
  old: ReportRow[]
  trash: { bytes: number; count: number; top: ReportRow[] }
  folder: {
    id: string | null
    path: PathStep[]
    bytes: number
    items: ReportRow[]
  }
}

// ---- Vaults ----

export type VaultSummary = {
  id: string
  name: string
  items: number
  bytes: number
  createdAt: string
}
export type VaultsResponse = {
  vaults: VaultSummary[]
  canCreate: boolean
  /** Why not, when canCreate is false. */
  why: string | null
}
export type VaultKeys = {
  salt: string
  wrapped: string
  recoveryWrapped: string
  kdf: { t: number; m: number }
}
export type CreateVaultRequest = VaultKeys & { name: string }
export type VaultResponse = VaultKeys & { id: string; name: string }
export type UpdateVaultKeyRequest = {
  salt: string
  wrapped: string
  kdf: { t: number; m: number }
}
export type VaultNode = {
  id: string
  parentId: string | null
  kind: "file" | "folder"
  /** Sealed. */
  name: string
  size: number
  updatedAt: string
  trashedAt: string | null
  /** The file's wrapped key. */
  encKey: string | null
  /** Has its name tag; send tags for the ones that don't. */
  tagged: boolean
}
export type VaultTreeResponse = { nodes: VaultNode[] }
export type VaultTagsRequest = { tags: { id: string; tag: string }[] }
export type VaultFolderInput = {
  /** Your handle for it; later folders may name it as `parent`. */
  key: string
  parent: string | null
  name: string
  tag: string
}
export type CreateVaultFoldersRequest = { folders: VaultFolderInput[] }
export type CreateVaultFoldersResponse = { ids: Record<string, string> }
export type RenameVaultNodeRequest = { name: string; tag: string }
export type VaultIdsRequest = { ids: string[] }
export type MoveVaultNodesRequest = {
  ids: string[]
  parentId: string | null
}
export type RestoreVaultNodesResponse = { kept?: number }
export type PlanVaultUploadRequest = {
  groups: { parentId: string | null; sizes: number[] }[]
}
export type PlanVaultUploadResponse = { tokens: string[] }
export type VaultFileResponse = { url: string; encKey: string; size: number }

// ---- Push ----

export type PushRequest = { endpoint: string }
/** What the server POSTs to a registered endpoint. No file names. */
export type PushPayload = { app: "nimbus"; id: string; text: string }
