import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

import { session, user } from "./auth-schema"
import type {
  Checks,
  Diff,
  Fingerprint,
  Kind,
  Provider,
  Retention,
  RunStatus,
  Trigger,
} from "../backup-rules"
import type { ActivityType } from "../activity-rules"
import type { Outcome, Service } from "../health-rules"
import type { PasswordPolicy } from "../password-policy"

export * from "./auth-schema"

// ponytail: random uuidv4 keys fragment indexes at scale; switch to uuidv7() on Postgres 18
const id = () => uuid("id").primaryKey().defaultRandom()
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

// Vault keys never reach the server in the clear: the browser wraps the vault key
// with an Argon2id key from the passphrase (salt, kdf_iterations = t, kdf_memory = m
// in KiB) and again with a key from the recovery code. See lib/vault-crypto.ts.
export const vaults = pgTable(
  "vaults",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    salt: text("salt").notNull(),
    wrappedKey: text("wrapped_key").notNull(),
    kdfIterations: integer("kdf_iterations").notNull(),
    kdfMemory: integer("kdf_memory").notNull(),
    recoveryWrappedKey: text("recovery_wrapped_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("vaults_owner_id_idx").on(t.ownerId)]
)

export const nodeKind = pgEnum("node_kind", ["file", "folder"])

// Files and folders share one tree. parent_id null means the owner's root.
// Trashing stamps trashed_at on a node and every untrashed descendant with one
// timestamp, so "not trashed" is a plain column check and restore can undo exactly
// that trash. Names are unique per folder, ignoring case, among untrashed nodes.
export const nodes = pgTable(
  "nodes",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => nodes.id, {
      onDelete: "cascade",
    }),
    vaultId: uuid("vault_id").references(() => vaults.id, {
      onDelete: "cascade",
    }),
    kind: nodeKind("kind").notNull(),
    name: text("name").notNull(),
    // Vault items: an HMAC of the lowercased name under a vault-derived key,
    // so same-named items in one folder can be refused without reading names.
    nameTag: text("name_tag"),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    mime: text("mime"),
    s3Key: text("s3_key"),
    // The version a file shows and downloads. s3_key, size and mime mirror it.
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => fileVersions.id,
      { onDelete: "set null" }
    ),
    // Off: people it's shared with as editors can't share it (or anything inside) further.
    allowReshare: boolean("allow_reshare").notNull().default(true),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    // Folders the app makes itself: "camera" | "phone_backup" | "partner". Null for the rest.
    systemKind: text("system_kind"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("nodes_owner_parent_idx").on(t.ownerId, t.parentId),
    index("nodes_parent_id_idx").on(t.parentId),
    index("nodes_vault_id_idx").on(t.vaultId),
    index("nodes_owner_trashed_idx")
      .on(t.ownerId)
      .where(sql`${t.trashedAt} is not null`),
    uniqueIndex("nodes_unique_name_idx")
      .on(
        t.ownerId,
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000')`,
        sql`lower(${t.name})`
      )
      .where(sql`${t.trashedAt} is null`),
    uniqueIndex("nodes_vault_name_idx")
      .on(
        t.vaultId,
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000')`,
        t.nameTag
      )
      .where(sql`${t.trashedAt} is null and ${t.nameTag} is not null`),
    index("nodes_owner_updated_idx").on(t.ownerId, t.updatedAt),
    // Name search (pg_trgm): substring and typo-tolerant matches.
    index("nodes_name_trgm_idx").using(
      "gin",
      sql`lower(${t.name}) gin_trgm_ops`
    ),
    check(
      "nodes_file_has_key",
      sql`(${t.kind} = 'folder') = (${t.s3Key} is null)`
    ),
    check("nodes_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ]
)

// Every upload of a file. The newest row is the current version, which nodes
// mirrors in s3_key/size/mime. Restore copies an old row to the top, so two rows
// can share an s3_key; an object is deleted only once no row points at it.
export const fileVersions = pgTable(
  "file_versions",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    s3Key: text("s3_key").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    mime: text("mime"),
    // The tus upload id, so finishing the same upload twice is a no-op.
    uploadId: text("upload_id").unique(),
    uploadedBy: text("uploaded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    // Uploads through a file-drop link: the link, and the name the uploader gave.
    viaShareId: uuid("via_share_id").references((): AnyPgColumn => shares.id, {
      onDelete: "set null",
    }),
    uploaderLabel: text("uploader_label"),
    // v1, v2, … per file. Stays put when other versions are deleted.
    number: integer("number").notNull(),
    note: text("note"),
    // Kept forever: automatic pruning skips it.
    keep: boolean("keep").notNull().default(false),
    // Thumbnail at thumbs/<s3Key>.webp: null until tried, "" when the browser
    // couldn't make one, otherwise a revision that changes when it's replaced.
    thumb: text("thumb"),
    // Vault files: the file's key, wrapped by the vault key. Null outside vaults.
    encKey: text("enc_key"),
    // SHA-256 (hex) the browser computed while uploading, for spotting duplicates.
    // Null when unknown (resumed uploads, WebDAV, vaults).
    sha256: text("sha256"),
    // Photos and videos: when it was taken (EXIF), else its upload time. The
    // worker fills it in; null means not looked at yet (the timeline then uses createdAt).
    takenAt: timestamp("taken_at", { withTimezone: true }),
    // Photos: where (EXIF GPS, owner-only), pixel size, and the smart groups the
    // worker found (null: not decided yet, empty: none). gpsChecked marks versions
    // the worker has read these from, since takenAt is set before it gets here.
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    width: integer("width"),
    height: integer("height"),
    gpsChecked: boolean("gps_checked").notNull().default(false),
    smart: text("smart").array(),
    // Phase 20: what the AI service has handled for this version: "faces" and
    // "clip:<model>". A version without the mark is in that feature's backlog.
    mlDone: text("ml_done").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("file_versions_node_number_idx").on(t.nodeId, t.number),
    index("file_versions_node_id_idx").on(t.nodeId),
    index("file_versions_s3_key_idx").on(t.s3Key),
    index("file_versions_sha256_idx")
      .on(t.sha256)
      .where(sql`${t.sha256} is not null`),
    index("file_versions_via_share_idx")
      .on(t.viaShareId)
      .where(sql`${t.viaShareId} is not null`),
  ]
)

export const TAG_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "teal",
  "indigo",
  "brown",
  "gray",
] as const
export type TagColor = (typeof TAG_COLORS)[number]

// Personal colored labels, like Finder tags. Only their owner sees them, on their
// own files and on files shared with them.
export const tags = pgTable(
  "tags",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").$type<TagColor>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tags_owner_name_idx").on(t.ownerId, sql`lower(${t.name})`),
    check("tags_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check(
      "tags_color_check",
      sql`${t.color} in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'teal', 'indigo', 'brown', 'gray')`
    ),
  ]
)

export const nodeTags = pgTable(
  "node_tags",
  {
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.tagId] }),
    index("node_tags_tag_id_idx").on(t.tagId),
  ]
)

export const shareRole = pgEnum("share_role", ["viewer", "editor"])

// A share is one of: a member (grantee_id), an email invite for someone without
// an account yet (grantee_email, bound to grantee_id when they sign up), or a
// public link (token). Shares are inherited by everything inside a folder; the
// highest role on any ancestor wins.
export const shares = pgTable(
  "shares",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    granteeId: text("grantee_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    granteeEmail: text("grantee_email"),
    token: text("token").unique(),
    role: shareRole("role").notNull().default("viewer"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Links only from here on.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    name: text("name"),
    passwordHash: text("password_hash"),
    // Bumped when the password changes, so old unlock cookies stop working.
    pwRev: integer("pw_rev").notNull().default(0),
    allowView: boolean("allow_view").notNull().default(true),
    allowDownload: boolean("allow_download").notNull().default(true),
    allowUpload: boolean("allow_upload").notNull().default(false),
    // Total bytes a file-drop link takes in. Null: only the owner's quota.
    uploadCapBytes: bigint("upload_cap_bytes", { mode: "number" }),
    // File requests: what visitors read, what they must give, what they may send.
    instructions: text("instructions"),
    requireEmail: boolean("require_email").notNull().default(false),
    perVisitorFolder: boolean("per_visitor_folder").notNull().default(false),
    maxFileBytes: bigint("max_file_bytes", { mode: "number" }),
    maxFiles: integer("max_files"),
    // Categories (images, pdf, docs, video, audio) and ".ext" entries. Null: any.
    allowedTypes: text("allowed_types").array(),
    viewCount: integer("view_count").notNull().default(0),
    downloadCount: integer("download_count").notNull().default(0),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("shares_node_id_idx").on(t.nodeId),
    index("shares_grantee_id_idx").on(t.granteeId),
    index("shares_created_by_idx").on(t.createdBy),
    uniqueIndex("shares_node_grantee_idx")
      .on(t.nodeId, t.granteeId)
      .where(sql`${t.granteeId} is not null`),
    uniqueIndex("shares_node_email_idx")
      .on(t.nodeId, sql`lower(${t.granteeEmail})`)
      .where(sql`${t.granteeEmail} is not null`),
    index("shares_grantee_email_idx")
      .on(sql`lower(${t.granteeEmail})`)
      .where(sql`${t.granteeEmail} is not null`),
    check(
      "shares_has_target",
      sql`${t.granteeId} is not null or ${t.token} is not null or ${t.granteeEmail} is not null`
    ),
  ]
)

// Every visit, download, upload and wrong password on a public link. Kept 90
// days (pruned with the trash). Also rate-limits unlocks and drops per IP.
export const linkEvents = pgTable(
  "link_events",
  {
    id: id(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<"view" | "download" | "upload" | "unlock_fail" | "confirm">()
      .notNull(),
    ip: text("ip"),
    ua: text("ua"),
    // What was downloaded or uploaded.
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("link_events_share_at_idx").on(t.shareId, t.at),
    index("link_events_ip_kind_at_idx").on(t.ip, t.kind, t.at),
  ]
)

// Who changed a file or folder: uploads, new versions, renames, moves, share changes, trash and restore.
// Views and downloads aren't recorded. Pruned by settings.activityRetentionDays.
export const activity = pgTable(
  "activity",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    // Null for a drop through a public link, or once the account is gone.
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    type: text("type").$type<ActivityType>().notNull(),
    // "old name" for a rename, "Ana as editor" for a share, and so on.
    detail: text("detail"),
    // What a rename or move changed from, for Restore to a point in time. Null before phase 17.
    fromName: text("from_name"),
    fromParentId: uuid("from_parent_id"),
    // A Restore to a point in time row: which one, for its Undo button. Points at point_restores,
    // declared further down, so it's a plain column.
    restoreId: uuid("restore_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_node_at_idx").on(t.nodeId, t.at),
    index("activity_at_idx").on(t.at),
  ]
)

export const AUTH_EVENT_KINDS = [
  "added",
  "switched",
  "signed_out",
  "saved_login_used",
  "device_linked",
] as const
export type AuthEventKind = (typeof AUTH_EVENT_KINDS)[number]

// Account switching on a shared browser, shown on the admin member page. Kept
// 90 days (pruned with link events).
export const authEvents = pgTable(
  "auth_events",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AuthEventKind>().notNull(),
    ip: text("ip"),
    ua: text("ua"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_events_user_at_idx").on(t.userId, t.at)]
)

// One-time QR and short-code sign-ins for phones (lib/device-link.ts). Secrets
// are stored hashed; a row lasts minutes.
export const deviceLinks = pgTable(
  "device_links",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    codeHash: text("code_hash").notNull().unique(),
    pollHash: text("poll_hash").unique(),
    status: text("status")
      .$type<"waiting" | "pending-approval" | "approved" | "denied" | "used">()
      .notNull()
      .default("waiting"),
    deviceName: text("device_name"),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("device_links_user_idx").on(t.userId)]
)

// What admins did: role and status changes, recovery, vault deletes, settings.
// Names are copied so the log still reads after an account is deleted. Kept a year.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id").references(() => user.id, {
      onDelete: "set null",
    }),
    targetName: text("target_name"),
    detail: text("detail"),
    // Secrets events: the project and environment name, and where the request came from.
    projectId: uuid("project_id"),
    env: text("env"),
    ip: text("ip"),
    device: text("device"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_at_idx").on(t.at),
    index("audit_events_project_at_idx").on(t.projectId, t.at),
    index("audit_events_target_at_idx").on(t.targetId, t.at),
  ]
)

// "Save your login info" on one browser: the cookie nimbus_saved_<id> holds a
// secret whose SHA-256 is stored here. Works for 90 days after its last use,
// and only while it's newer than the account's last password change.
export const savedLogins = pgTable(
  "saved_logins",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull(),
    ua: text("ua"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("saved_logins_user_idx").on(t.userId)]
)

// WebDAV sign-in, one per device. The token is 32 random bytes shown once; only
// its SHA-256 is kept. Stops working 90 days after its last use.
export const appPasswords = pgTable(
  "app_passwords",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: text("scope").$type<"rw" | "ro">().notNull(),
    hash: text("hash").notNull().unique(),
    lastFour: text("last_four").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastIp: text("last_ip"),
  },
  (t) => [
    index("app_passwords_user_idx").on(t.userId),
    check("app_passwords_scope_check", sql`${t.scope} in ('rw', 'ro')`),
  ]
)

// Where the Android app wants its pushes: a UnifiedPush endpoint is a plain URL
// the server POSTs to. One row per endpoint; registering again moves it.
export const pushEndpoints = pgTable(
  "push_endpoints",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("push_endpoints_user_idx").on(t.userId)]
)

// Stars are per person, so shared items can be starred too.
export const stars = pgTable(
  "stars",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId] }),
    index("stars_node_id_idx").on(t.nodeId),
  ]
)

// "Add shortcut to My files": something shared with you, shown in your root.
export const shortcuts = pgTable(
  "shortcuts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId] }),
    index("shortcuts_node_id_idx").on(t.nodeId),
  ]
)

// Ownership waits for the new owner to accept. One pending transfer per item.
export const ownershipTransfers = pgTable("ownership_transfers", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => nodes.id, { onDelete: "cascade" }),
  fromId: text("from_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  toId: text("to_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
})

export const NOTIFICATION_KINDS = [
  "shared",
  "access_changed",
  "access_removed",
  "file_drop",
  "edits",
  "transfer",
  // Someone downloaded a Transfer you sent (labelled "Transfers").
  "transfer_download",
  // A new thread on your file, a reply in a thread you're in, or an @mention.
  "comment",
  // Photos shared with you in an album, or added to one (folded hourly); and partner sharing.
  "album",
  "partner",
  "signup_request",
  "service_health",
  "backup",
  "app_password",
  "storage_low",
  // A phone has had no new contacts or calendar copy for 7 days.
  "phone_backup",
  // Secrets: change requests, access requests, rotation and token expiry, being added to a project.
  "secrets",
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
// Only admins get these, so only admins see their settings.
export const ADMIN_KINDS: NotificationKind[] = [
  "signup_request",
  "service_health",
  "backup",
]

// The bell. Edits in a shared folder fold into one unread row per folder per
// hour (`count` goes up) so a big upload is one notification, not hundreds.
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NotificationKind>().notNull(),
    nodeId: uuid("node_id").references(() => nodes.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    count: integer("count").notNull().default(1),
    // Kind-specific text bits: the role given, the uploader's name, …
    data: jsonb("data").$type<Record<string, string>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ]
)

// Email on or off per kind. No row: on.
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NotificationKind>().notNull(),
    email: boolean("email").notNull(),
    bell: boolean("bell").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })]
)

export const SIGNUP_MODES = ["approval", "invite", "open", "closed"] as const
export type SignupMode = (typeof SIGNUP_MODES)[number]

// The bottom-right corner belongs to the upload panel.
export const TOAST_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
] as const
export type ToastPosition = (typeof TOAST_POSITIONS)[number]

export const EMAIL_TRANSPORTS = ["none", "smtp", "resend"] as const
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number]

// One row of instance-wide settings. The boolean key pins it to a single row.
export const settings = pgTable(
  "settings",
  {
    id: boolean("id").primaryKey().default(true),
    signupMode: text("signup_mode")
      .$type<SignupMode>()
      .notNull()
      .default("approval"),
    trustedDomains: text("trusted_domains").array().notNull().default([]),
    // Password accounts must turn on two-factor before they can use the app.
    require2fa: boolean("require_2fa").notNull().default(false),
    // Passkeys (sign-in and two-factor). They also need HTTPS and a domain name.
    passkeysEnabled: boolean("passkeys_enabled").notNull().default(true),
    // Everyone must add a passkey before they can use the app.
    requirePasskey: boolean("require_passkey").notNull().default(false),
    // Email, used when no EMAIL_TRANSPORT is set in env. Secrets are sealed by lib/crypto.
    emailTransport: text("email_transport")
      .$type<EmailTransport>()
      .notNull()
      .default("none"),
    emailFrom: text("email_from"),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpSecure: boolean("smtp_secure").notNull().default(false),
    smtpUser: text("smtp_user"),
    smtpPassword: text("smtp_password"),
    resendApiKey: text("resend_api_key"),
    // Trashed items older than this are deleted for good. Null keeps them until emptied.
    trashRetentionDays: integer("trash_retention_days"),
    // Activity feed events older than this are deleted. Null keeps them.
    activityRetentionDays: integer("activity_retention_days").default(90),
    // Uploads. Null means no limit.
    maxUploadBytes: bigint("max_upload_bytes", { mode: "number" }),
    // Web uploader speed cap per member, bytes a second. Null: no cap.
    uploadSpeedBytes: bigint("upload_speed_bytes", { mode: "number" }),
    // Storage each member gets unless they have their own. Null: unlimited.
    defaultQuotaBytes: bigint("default_quota_bytes", { mode: "number" }),
    // Largest PDF the PDF tools open for editing (Phase 18).
    maxPdfEditBytes: bigint("max_pdf_edit_bytes", { mode: "number" }).notNull().default(104857600),
    // Lowercase, without the dot.
    blockedExtensions: text("blocked_extensions").array().notNull().default([]),
    versionKeepLast: integer("version_keep_last"),
    versionMaxAgeDays: integer("version_max_age_days"),
    // Collabora (WOPI) server the browser can reach, e.g. http://localhost:9980. Null: off.
    officeUrl: text("office_url"),
    // Public links.
    publicLinksEnabled: boolean("public_links_enabled").notNull().default(true),
    maxLinkDays: integer("max_link_days"),
    requireLinkPassword: boolean("require_link_password")
      .notNull()
      .default(false),
    // Transfer (send copies of files by link or email) and Vault share links.
    transfersEnabled: boolean("transfers_enabled").notNull().default(true),
    vaultLinksEnabled: boolean("vault_links_enabled").notNull().default(true),
    // Longest a transfer may last, in days (the picker offers 1/7/30 up to this). Null: 30.
    transferMaxDays: integer("transfer_max_days"),
    // Biggest transfer, in bytes. Null: only the sender's quota.
    transferMaxBytes: bigint("transfer_max_bytes", { mode: "number" }),
    // Tesseract languages for reading text in images, joined with "+".
    ocrLangs: text("ocr_langs").notNull().default("eng"),
    // What the worker reads text from (Phase 19): off, images, images_pdfs or all.
    ocrMode: text("ocr_mode")
      .$type<"off" | "images" | "images_pdfs" | "all">()
      .notNull()
      .default("all"),
    // Video text is read from the first this-many minutes.
    ocrVideoMaxMin: integer("ocr_video_max_min").notNull().default(120),
    // {lang: "ready" | "failed: reason"}, written by the worker's language download.
    ocrLangStatus: jsonb("ocr_lang_status")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // Phase 20, the optional nimbus-ml service. Empty URL: use the ML_URL env.
    mlUrl: text("ml_url").notNull().default(""),
    mlSpeech: boolean("ml_speech").notNull().default(false),
    mlClip: boolean("ml_clip").notNull().default(false),
    mlFaces: boolean("ml_faces").notNull().default(false),
    whisperModel: text("whisper_model").notNull().default("base"),
    clipModel: text("clip_model").notNull().default("vitb32"),
    // Faces for members who haven't chosen: on (opt-out) or off (opt-in).
    facesDefault: boolean("faces_default").notNull().default(false),
    aiAccess: text("ai_access")
      .$type<"everyone" | "chosen">()
      .notNull()
      .default("everyone"),
    // Vaults. Off stops new vaults; existing ones keep working. Null cap: no limit.
    vaultsEnabled: boolean("vaults_enabled").notNull().default(true),
    maxVaultsPerMember: integer("max_vaults_per_member"),
    // Secrets (env keys and values). Null caps: no limit.
    secretsEnabled: boolean("secrets_enabled").notNull().default(true),
    maxSecretProjectsPerMember: integer("max_secret_projects_per_member"),
    maxSecretsPerProject: integer("max_secrets_per_project"),
    // Machine tokens (nms_) and the CLI (nmu_ sign-in, downloads). Off refuses them; nothing is deleted.
    secretTokensEnabled: boolean("secret_tokens_enabled").notNull().default(true),
    secretCliEnabled: boolean("secret_cli_enabled").notNull().default(true),
    // Secrets governance (S3). Null limits: none.
    secretSharesEnabled: boolean("secret_shares_enabled").notNull().default(true),
    secretRequire2fa: boolean("secret_require_2fa").notNull().default(false),
    secretMaxIdleMinutes: integer("secret_max_idle_minutes"),
    secretUnlockMaxHours: integer("secret_unlock_max_hours"),
    secretTrashDays: integer("secret_trash_days"),
    // Where action messages (toasts) appear for everyone.
    toastPosition: text("toast_position")
      .$type<ToastPosition>()
      .notNull()
      .default("bottom-center"),
    // Several accounts signed in on one browser, switched from the account menu.
    multiAccount: boolean("multi_account").notNull().default(true),
    maxAccounts: integer("max_accounts").notNull().default(5),
    // One-tap "saved login info" on the sign-in page; owners and admins only
    // get it when the second switch is on.
    savedLogins: boolean("saved_logins").notNull().default(true),
    savedLoginsAdmins: boolean("saved_logins_admins").notNull().default(false),
    // Signing in phones by QR or short code from Account (lib/device-link.ts).
    deviceLinks: boolean("device_links").notNull().default(true),
    // Mounting files over WebDAV at /dav with app passwords.
    webdav: boolean("webdav").notNull().default(true),
    // Rules for new passwords and vault passphrases. Null: the owner hasn't
    // chosen, so the industry-standard defaults apply (lib/password-policy).
    passwordPolicy: jsonb("password_policy").$type<PasswordPolicy>(),
    // Photos map (Places): the tile style URL goes to a third party by default.
    mapEnabled: boolean("map_enabled").notNull().default(true),
    mapStyleUrl: text("map_style_url")
      .notNull()
      .default("https://tiles.openfreemap.org/styles/liberty"),
    // Thumbnails and search text the worker makes for files no browser handled.
    deriveConcurrency: integer("derive_concurrency").notNull().default(1),
    deriveMaxBytes: bigint("derive_max_bytes", { mode: "number" })
      .notNull()
      .default(200 * 1024 * 1024),
    // Data-saver video copies (720p and 480p) the worker makes. Off until an admin
    // turns them on. Cap: total bytes of all copies; null: no cap.
    videoCopies: boolean("video_copies").notNull().default(false),
    videoCopyCapBytes: bigint("video_copy_cap_bytes", { mode: "number" }),
    // One OpenID Connect provider, used when no OIDC_ISSUER is set in env. The
    // secret is sealed by lib/crypto. Null issuer: off.
    oidcName: text("oidc_name"),
    oidcIssuer: text("oidc_issuer"),
    oidcClientId: text("oidc_client_id"),
    oidcClientSecret: text("oidc_client_secret"),
    // Only OIDC sign-in, except the owner's password.
    oidcOnly: boolean("oidc_only").notNull().default(false),
    // OIDC sign-in skips Nimbus two-factor: the provider asks for its own.
    oidcTrustMfa: boolean("oidc_trust_mfa").notNull().default(false),
    // Health checks (Admin → Health). Null interval: no scheduled checks.
    healthIntervalMin: integer("health_interval_min").default(5),
    healthFailures: integer("health_failures").notNull().default(2),
    healthRetentionDays: integer("health_retention_days").notNull().default(30),
    healthDisabled: text("health_disabled")
      .$type<Service>()
      .array()
      .notNull()
      .default([]),
    // Per-service overrides of DEFAULT_SLOW_MS in lib/health-rules.
    healthSlowMs: jsonb("health_slow_ms")
      .$type<Partial<Record<Service, number>>>()
      .notNull()
      .default({}),
    // Backups (Admin → Backups). Off until an admin turns each kind on.
    backupDbEnabled: boolean("backup_db_enabled").notNull().default(false),
    backupDbIntervalH: integer("backup_db_interval_h").notNull().default(6),
    backupDbStart: text("backup_db_start").notNull().default("03:00"),
    backupFilesEnabled: boolean("backup_files_enabled")
      .notNull()
      .default(false),
    backupFilesIntervalH: integer("backup_files_interval_h")
      .notNull()
      .default(24),
    backupFilesStart: text("backup_files_start").notNull().default("02:00"),
    backupTz: text("backup_tz").notNull().default("UTC"),
    backupPaused: boolean("backup_paused").notNull().default(false),
    backupRetention: jsonb("backup_retention")
      .$type<Retention>()
      .notNull()
      // In jsonb's own key order, so "Changed" (lib/signup isModified) compares equal.
      .default({ days: 30, mode: "tiered", hours: 48, weeks: 12, months: 12 }),
    // Files purged from Nimbus stay in the backup this long.
    backupFilesGraceDays: integer("backup_files_grace_days")
      .notNull()
      .default(30),
    backupFilesEncrypt: boolean("backup_files_encrypt")
      .notNull()
      .default(true),
    backupFilesConcurrency: integer("backup_files_concurrency")
      .notNull()
      .default(4),
    backupFilesSamplePct: integer("backup_files_sample_pct")
      .notNull()
      .default(1),
    backupRetryAttempts: integer("backup_retry_attempts").notNull().default(1),
    backupRetryDelayMin: integer("backup_retry_delay_min")
      .notNull()
      .default(15),
    // Null: no shrink warning.
    backupShrinkWarnPct: integer("backup_shrink_warn_pct").default(20),
    // Which events email the admins. Empty: none.
    backupAlerts: text("backup_alerts")
      .$type<"failure" | "warning" | "stale">()
      .array()
      .notNull()
      .default(["failure", "warning"]),
    // Where backups go, used when no BACKUP_S3_BUCKET is set in env. Keys are
    // sealed by lib/crypto. Null bucket: not set up.
    backupProvider: text("backup_provider").$type<Provider>(),
    backupEndpoint: text("backup_endpoint"),
    backupRegion: text("backup_region"),
    backupBucket: text("backup_bucket"),
    backupFolder: text("backup_folder").notNull().default("nimbus"),
    backupPathStyle: boolean("backup_path_style").notNull().default(false),
    backupAccessKey: text("backup_access_key"),
    backupSecretKey: text("backup_secret_key"),
    // Where backup_objects' copies are. A different destination starts the mirror over.
    backupMirrorAt: text("backup_mirror_at"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("settings_single_row", sql`${t.id}`),
    check(
      "settings_signup_mode_check",
      sql`${t.signupMode} in ('approval', 'invite', 'open', 'closed')`
    ),
    check(
      "settings_email_transport_check",
      sql`${t.emailTransport} in ('none', 'smtp', 'resend')`
    ),
    check(
      "settings_trash_retention_positive",
      sql`${t.trashRetentionDays} is null or ${t.trashRetentionDays} > 0`
    ),
    check(
      "settings_health_positive",
      sql`(${t.healthIntervalMin} is null or ${t.healthIntervalMin} > 0) and ${t.healthFailures} > 0 and ${t.healthRetentionDays} > 0`
    ),
  ]
)

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" })

// Text found inside a file, for search. Only the current version is indexed: a
// row whose version_id isn't the node's current one is stale. An empty body
// means there was nothing to read.
export const nodeContent = pgTable(
  "node_content",
  {
    nodeId: uuid("node_id")
      .primaryKey()
      .references(() => nodes.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    body: text("body").notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', body)`),
    // How the text was read: text, pdf, docx, sheet or ocr.
    source: text("source").notNull(),
    // The languages the text was read with, to re-read when they change.
    ocrLangs: text("ocr_langs"),
    // Why the text couldn't be read; the sweep doesn't retry the version.
    ocrFailed: text("ocr_failed"),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("node_content_tsv_idx").using("gin", t.tsv)]
)

// Where text sits in a file (Phase 19): a PDF page, a video moment or an image
// line with its box. Rows of a stale version_id are ignored.
export const nodeTextParts = pgTable(
  "node_text_parts",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    kind: text("kind").$type<"page" | "time" | "line">().notNull(),
    page: integer("page"),
    tMs: integer("t_ms"),
    // [x, y, w, h] as 0-1 fractions of the image.
    box: jsonb("box").$type<[number, number, number, number]>(),
    // Phase 20: where the text came from. Speech parts are kind "time" with an end.
    source: text("source").$type<"ocr" | "speech">().notNull().default("ocr"),
    endMs: integer("end_ms"),
    body: text("body").notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', body)`),
  },
  (t) => [
    index("node_text_parts_node_idx").on(t.nodeId),
    index("node_text_parts_tsv_idx").using("gin", t.tsv),
  ]
)

// What was said in a video or audio file (Phase 20), by the nimbus-ml service.
// Its lines are in node_text_parts (source "speech"). noSpeech: nothing to hear.
export const nodeSpeech = pgTable(
  "node_speech",
  {
    nodeId: uuid("node_id")
      .primaryKey()
      .references(() => nodes.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    lang: text("lang"),
    // The Whisper model it was made with, to redo it when the admin picks another.
    model: text("model").notNull(),
    body: text("body").notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', body)`),
    noSpeech: boolean("no_speech").notNull().default(false),
    failed: text("failed"),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("node_speech_tsv_idx").using("gin", t.tsv)]
)

// What a picture looks like (Phase 20, CLIP): one row per photo, or per sampled
// video frame (t_ms). Needs the pgvector extension; the migration skips it without.
export const nodeEmbeddings = pgTable(
  "node_embeddings",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    tMs: integer("t_ms"),
    model: text("model").notNull(),
    vec: vector("vec", { dimensions: 512 }).notNull(),
  },
  (t) => [
    index("node_embeddings_node_idx").on(t.nodeId),
    index("node_embeddings_vec_idx").using("hnsw", t.vec.op("vector_cosine_ops")),
  ]
)

// People found in an owner's own photos (Phase 20). Never shared across accounts.
export const people = pgTable(
  "people",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name"),
    hidden: boolean("hidden").notNull().default(false),
    // Off: no "With X" memory cards for this person.
    memories: boolean("memories").notNull().default(true),
    coverFaceId: uuid("cover_face_id"),
    // Mean of the person's face vectors, normalised; the match target for new faces.
    centroid: vector("centroid", { dimensions: 128 }),
    createdAt: createdAt(),
  },
  (t) => [index("people_owner_idx").on(t.ownerId)]
)

export const faces = pgTable(
  "faces",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    // "Is this X?": a near match that isn't joined yet.
    suggestPersonId: uuid("suggest_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    // People this face was said not to be.
    rejected: uuid("rejected").array().notNull().default(sql`'{}'::uuid[]`),
    // [x, y, w, h] as 0-1 fractions of the image. Null with vec: a photo tagged by hand
    // ("Add to person") where no face was found.
    box: jsonb("box").$type<[number, number, number, number]>(),
    score: doublePrecision("score").notNull(),
    vec: vector("vec", { dimensions: 128 }),
  },
  (t) => [
    index("faces_node_idx").on(t.nodeId),
    index("faces_owner_person_idx").on(t.ownerId, t.personId),
    index("faces_vec_idx").using("hnsw", t.vec.op("vector_cosine_ops")),
  ]
)

// When each person last opened something, for Recent.
export const nodeOpens = pgTable(
  "node_opens",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId] }),
    index("node_opens_user_idx").on(t.userId, t.openedAt),
  ]
)

// Admin-made sign-up links. Using one creates an active account, skipping approval.
export const invites = pgTable(
  "invites",
  {
    id: id(),
    token: text("token").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "invites_max_uses_positive",
      sql`${t.maxUses} is null or ${t.maxUses} > 0`
    ),
  ]
)

export type User = typeof user.$inferSelect
export type Role = "owner" | "admin" | "member"
export type Status = "pending" | "active" | "rejected"

// One row per service per health check run. The latest row is the current
// state; the run of rows before it decides degraded vs down (lib/health-rules).
export const healthChecks = pgTable(
  "health_checks",
  {
    id: id(),
    service: text("service").$type<Service>().notNull(),
    outcome: text("outcome").$type<Outcome>().notNull(),
    // Null when nothing was timed (off, or checked without a request).
    latencyMs: integer("latency_ms"),
    // What was probed, or what went wrong.
    detail: text("detail").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("health_checks_service_idx").on(t.service, t.checkedAt.desc()),
    index("health_checks_checked_idx").on(t.checkedAt),
    check(
      "health_checks_outcome_check",
      sql`${t.outcome} in ('ok', 'slow', 'fail', 'off')`
    ),
  ]
)

// Every backup attempt, kept after its file is deleted (deleted_at) as history.
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: id(),
    kind: text("kind").$type<Kind>().notNull(),
    trigger: text("trigger").$type<Trigger>().notNull(),
    // A retry's first attempt, or the run a re-verify checked.
    sourceRunId: uuid("source_run_id").references(
      (): AnyPgColumn => backupRuns.id,
      { onDelete: "set null" }
    ),
    attempt: integer("attempt").notNull().default(1),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<RunStatus>().notNull().default("running"),
    // What it's doing now, while running.
    step: text("step"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Database dumps: the object in the backup bucket.
    s3Key: text("s3_key"),
    // Dump size, or bytes copied this run for files.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    dbSizeBytes: bigint("db_size_bytes", { mode: "number" }),
    // Files: objects copied/removed/sampled, and the mirror's size after.
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    checks: jsonb("checks").$type<Checks>().notNull().default({}),
    // The live database at dump time, for re-verifying the file later.
    fingerprint: jsonb("fingerprint").$type<Fingerprint>(),
    diffs: jsonb("diffs").$type<Diff[]>().notNull().default([]),
    error: text("error"),
    pinned: boolean("pinned").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
  },
  (t) => [
    index("backup_runs_kind_idx").on(t.kind, t.startedAt.desc()),
    // One run of each kind at a time.
    uniqueIndex("backup_runs_one_running")
      .on(t.kind)
      .where(sql`${t.status} = 'running'`),
    check("backup_runs_kind_check", sql`${t.kind} in ('db', 'files')`),
    check(
      "backup_runs_status_check",
      sql`${t.status} in ('running', 'ok', 'warning', 'failed', 'skipped')`
    ),
  ]
)

// Append-only: notes, pins and unpins on a run.
export const backupNotes = pgTable(
  "backup_notes",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => backupRuns.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").$type<"note" | "pin" | "unpin">().notNull(),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("backup_notes_run_idx").on(t.runId, t.createdAt),
    check(
      "backup_notes_kind_check",
      sql`${t.kind} in ('note', 'pin', 'unpin')`
    ),
  ]
)

// What the file mirror holds: one row per object copied to the backup bucket.
// gone_at: Nimbus no longer has it; the copy is deleted after the grace days.
export const backupObjects = pgTable(
  "backup_objects",
  {
    key: text("key").primaryKey(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    encrypted: boolean("encrypted").notNull(),
    copiedAt: timestamp("copied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    goneAt: timestamp("gone_at", { withTimezone: true }),
  },
  (t) => [index("backup_objects_gone_idx").on(t.goneAt)]
)

// Re-auth for sensitive backup actions, per session: an emailed code while
// waiting, then verified_until once proven.
export const backupReauth = pgTable("backup_reauth", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  codeHash: text("code_hash"),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  codeSentAt: timestamp("code_sent_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  verifiedUntil: timestamp("verified_until", { withTimezone: true }),
})

// Transfer: copies of files sent by link or email, deleted at expiry (hourly
// purge). Their bytes count against the sender's quota until then.
export const transfers = pgTable(
  "transfers",
  {
    id: id(),
    senderId: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    message: text("message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    passwordHash: text("password_hash"),
    // Full downloads allowed (a zip, or the first file download in a visit). Null: no limit.
    downloadLimit: integer("download_limit"),
    downloads: integer("downloads").notNull().default(0),
    // Files are still being added (device uploads); recipients can't open it yet.
    draft: boolean("draft").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("transfers_sender_idx").on(t.senderId),
    index("transfers_expires_idx").on(t.expiresAt),
  ]
)

export const transferFiles = pgTable(
  "transfer_files",
  {
    id: id(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    mime: text("mime"),
    s3Key: text("s3_key").notNull(),
    // Thumbnail at thumbs/<s3Key>.webp when one was made.
    thumb: boolean("thumb").notNull().default(false),
    // tus upload id, so finishing twice adds the file once.
    uploadId: text("upload_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("transfer_files_transfer_idx").on(t.transferId)]
)

// One link per emailed recipient, plus one with email null for "copy link".
export const transferRecipients = pgTable(
  "transfer_recipients",
  {
    id: id(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    email: text("email"),
    token: text("token").notNull().unique(),
    downloads: integer("downloads").notNull().default(0),
    lastAt: timestamp("last_at", { withTimezone: true }),
  },
  (t) => [index("transfer_recipients_transfer_idx").on(t.transferId)]
)

// Views, downloads and wrong passwords, like link_events.
export const transferEvents = pgTable(
  "transfer_events",
  {
    id: id(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => transferRecipients.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<"view" | "download" | "unlock_fail" | "save">()
      .notNull(),
    ip: text("ip"),
    ua: text("ua"),
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transfer_events_recipient_at_idx").on(t.recipientId, t.at),
    index("transfer_events_ip_kind_at_idx").on(t.ip, t.kind, t.at),
  ]
)

// Vault share links: no data is copied. The browser re-wraps each shared file's
// key under a fresh link key and seals a manifest ({path,size,mime,versionId,
// fileKey}[]) with it. The link key travels in the URL's # (never sent here), or
// is wrapped by a passphrase (kdf_salt + wrapped_link_key). Deleting the row
// (Revoke) deletes the wrapped keys with it.
export const vaultLinks = pgTable(
  "vault_links",
  {
    id: id(),
    token: text("token").notNull().unique(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    manifest: text("manifest").notNull(),
    kdfSalt: text("kdf_salt"),
    kdfIterations: integer("kdf_iterations"),
    kdfMemory: integer("kdf_memory"),
    wrappedLinkKey: text("wrapped_link_key"),
    // Sealed with the vault key, so only the owner's list can show what it is.
    label: text("label").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("vault_links_owner_idx").on(t.ownerId)]
)

// Which ciphertexts a vault link may fetch. A version deleted later drops out.
export const vaultLinkVersions = pgTable(
  "vault_link_versions",
  {
    linkId: uuid("link_id")
      .notNull()
      .references(() => vaultLinks.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.versionId] })]
)

// Threads on files. A reply's parent is the thread's first comment; threads are one level deep.
// Kept across versions and with the file on ownership transfer (they hang off the node).
// Deleting a comment that has replies keeps a stub (body null, deletedAt set).
export const comments = pgTable(
  "comments",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body"),
    // Mentioned user ids, kept so an edit only notifies the newly mentioned.
    mentions: text("mentions").array().notNull().default(sql`'{}'`),
    // Optional anchors: a point in a video or audio file, or a page of a PDF or document.
    atSeconds: integer("at_seconds"),
    page: integer("page"),
    // On a thread's first comment only.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_node_idx").on(t.nodeId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
    index("comments_body_fts_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.body}, ''))`
    ),
  ]
)

export const commentReactions = pgTable(
  "comment_reactions",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId, t.emoji] })]
)

// Albums point at photos, which stay where they are. Members of an album see its photos
// (lib/access accessTo); contributors may add their own.
export const albums = pgTable(
  "albums",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    coverNodeId: uuid("cover_node_id").references(() => nodes.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("albums_owner_idx").on(t.ownerId)]
)

export const albumItems = pgTable(
  "album_items",
  {
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.nodeId] }),
    index("album_items_node_idx").on(t.nodeId),
  ]
)

// A person (grantee_id) or a public link (token, with expiry and password like shares).
export const albumShares = pgTable(
  "album_shares",
  {
    id: id(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    granteeId: text("grantee_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    token: text("token").unique(),
    role: text("role").$type<"viewer" | "contributor">().notNull().default("viewer"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    passwordHash: text("password_hash"),
    pwRev: integer("pw_rev").notNull().default(0),
    allowDownload: boolean("allow_download").notNull().default(true),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("album_shares_album_idx").on(t.albumId),
    index("album_shares_grantee_idx").on(t.granteeId),
    uniqueIndex("album_shares_album_grantee_idx")
      .on(t.albumId, t.granteeId)
      .where(sql`${t.granteeId} is not null`),
    check(
      "album_shares_has_target",
      sql`${t.granteeId} is not null or ${t.token} is not null`
    ),
  ]
)

// Partner sharing: `ownerId` shares their photos (all, or taken on/after `since`) with
// `partnerId`, who merges them into their timeline unless `hidden`.
export const partners = pgTable(
  "partners",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    partnerId: text("partner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    since: timestamp("since", { withTimezone: true }),
    status: text("status").$type<"pending" | "active">().notNull().default("pending"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.partnerId] }),
    index("partners_partner_idx").on(t.partnerId),
  ]
)

// What a member keeps out of "On this day": one photo, a day ("MM-DD") or a folder.
export const memoryHides = pgTable(
  "memory_hides",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"photo" | "day" | "folder">().notNull(),
    nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
    day: text("day"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memory_hides_node_idx")
      .on(t.userId, t.nodeId)
      .where(sql`${t.nodeId} is not null`),
    uniqueIndex("memory_hides_day_idx")
      .on(t.userId, t.day)
      .where(sql`${t.day} is not null`),
  ]
)

// Data-saver copies of a video: one row per source object (s3_key, which versions share)
// and size. "skipped": the original already is that size (or smaller) in H.264.
// The object is renditions/<source_key>.<height>.mp4. Not counted against quota.
export const videoRenditions = pgTable(
  "video_renditions",
  {
    id: id(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    height: integer("height").notNull(),
    key: text("key"),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    status: text("status")
      .$type<"pending" | "done" | "skipped" | "failed">()
      .notNull()
      .default("pending"),
    // The original's video codec as ffprobe names it (h264, hevc ...).
    codec: text("codec"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("video_renditions_source_idx").on(t.sourceKey, t.height),
    index("video_renditions_node_idx").on(t.nodeId),
  ]
)

// Where a member left off in a long video or audio file, synced across their devices.
export const playbackPositions = pgTable(
  "playback_positions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    positionSec: doublePrecision("position_sec").notNull(),
    durationSec: doublePrecision("duration_sec").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nodeId] })]
)

// How to put back what one Restore to a point in time changed, for its Undo (7 days).
export type PointRestoreUndo =
  | { kind: "retrash"; nodeId: string }
  | { kind: "name"; nodeId: string; name: string }
  | { kind: "parent"; nodeId: string; parentId: string | null; name: string }
  | { kind: "version"; nodeId: string; versionId: string }

export const pointRestores = pgTable(
  "point_restores",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null: all of My files.
    folderId: uuid("folder_id").references(() => nodes.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    undo: jsonb("undo").$type<PointRestoreUndo[]>().notNull(),
    createdAt: createdAt(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("point_restores_owner_idx").on(t.ownerId, t.createdAt)]
)

// Phase 18: a saved signature and initials per account, placed on PDFs. PNG as base64 (small, capped by the API).
export const signatures = pgTable(
  "signatures",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"signature" | "initials">().notNull(),
    png: text("png").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })]
)

// Phase 18: contacts and calendar backup, one row per phone. The phone reports what it has on and when it last
// wrote a copy; the daily job sends a bell after 7 days without one. Files live in My files → Phone backup → <device>.
export const phoneBackups = pgTable(
  "phone_backups",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceName: text("device_name").notNull(),
    folderId: uuid("folder_id").references(() => nodes.id, { onDelete: "set null" }),
    contacts: boolean("contacts").notNull().default(false),
    calendar: boolean("calendar").notNull().default(false),
    lastContactsAt: timestamp("last_contacts_at", { withTimezone: true }),
    lastCalendarAt: timestamp("last_calendar_at", { withTimezone: true }),
    staleNotifiedAt: timestamp("stale_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("phone_backups_user_device_idx").on(t.userId, t.deviceName)]
)

// ---- Secrets -----------------------------------------------------------------
// Values are sealed with the project's data key, which SECRETS_ROOT_KEY wraps
// (lib/secrets/kms.ts). Key names, comments and tags stay readable so they can
// be searched; values never are.

// Per-member Secrets preferences: idle auto-lock, optional PIN, failed-unlock lockout.
export const secretSettings = pgTable("secret_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lockMinutes: integer("lock_minutes").notNull().default(15),
  pinHash: text("pin_hash"),
  fails: integer("fails").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
})

// The server-enforced unlock: one row per signed-in session, slid forward by
// every Secrets request and dead after lock_minutes of nothing.
export const secretUnlocks = pgTable("secret_unlocks", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  challenge: text("challenge"),
  challengeExpiresAt: timestamp("challenge_expires_at", { withTimezone: true }),
})

export const secretProjects = pgTable("secret_projects", {
  id: id(),
  name: text("name").notNull(),
  // Lowercase, unique: how the CLI and REST API name the project.
  slug: text("slug").notNull().unique(),
  description: text("description"),
  // The project data key, wrapped by SECRETS_ROOT_KEY. Rotating the root key re-wraps this.
  wrappedKey: text("wrapped_key").notNull(),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
})

// role is admin | developer | viewer; S1 only creates admins (the creator).
export const secretMembers = pgTable(
  "secret_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<"admin" | "developer" | "viewer">().notNull().default("admin"),
    // Environments a developer or viewer can see; null is all of them (admins always see all).
    envIds: uuid("env_ids").array(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("secret_members_user_idx").on(t.userId),
  ]
)

export const secretEnvs = pgTable(
  "secret_envs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Lowercase, used in ${env.KEY} references and the API.
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    // Bumped on every write here (the API's ETag and watch).
    version: integer("version").notNull().default(1),
    // Protected: edits become change requests that `approvalsRequired` approvers
    // (approverIds, or the project's admins when null) must approve first.
    protected: boolean("protected").notNull().default(false),
    approvalsRequired: integer("approvals_required").notNull().default(1),
    approverIds: text("approver_ids").array(),
    adminBypass: boolean("admin_bypass").notNull().default(false),
  },
  (t) => [uniqueIndex("secret_envs_slug_idx").on(t.projectId, t.slug)]
)

export const secretFolders = pgTable(
  "secret_folders",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    envId: uuid("env_id")
      .notNull()
      .references(() => secretEnvs.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => secretFolders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
  },
  (t) => [index("secret_folders_env_idx").on(t.envId)]
)

// deleted_at set = in the project's trash. Key names are unique per folder among live secrets.
export const secrets = pgTable(
  "secrets",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    envId: uuid("env_id")
      .notNull()
      .references(() => secretEnvs.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => secretFolders.id, {
      onDelete: "set null",
    }),
    key: text("key").notNull(),
    valueEnc: text("value_enc").notNull(),
    comment: text("comment"),
    type: text("type"),
    rotationAt: timestamp("rotation_at", { withTimezone: true }),
    // The rotation_at the reminder went out for, so it fires once per date.
    rotationNotifiedFor: timestamp("rotation_notified_for", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("secrets_root_key_idx")
      .on(t.envId, t.key)
      .where(sql`${t.folderId} is null and ${t.deletedAt} is null`),
    uniqueIndex("secrets_folder_key_idx")
      .on(t.envId, t.folderId, t.key)
      .where(sql`${t.folderId} is not null and ${t.deletedAt} is null`),
    index("secrets_project_idx").on(t.projectId),
  ]
)

// One row per change (create, update, delete, restore, import), for the history UI in S3.
export const secretVersions = pgTable(
  "secret_versions",
  {
    id: id(),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    valueEnc: text("value_enc").notNull(),
    comment: text("comment"),
    type: text("type"),
    action: text("action").notNull(),
    // The key and folder at that moment (null on rows from before S3).
    key: text("key"),
    folderId: uuid("folder_id"),
    changedBy: text("changed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("secret_versions_secret_idx").on(t.secretId, t.version)]
)

// A member's own value for a key, used only for them (not in exports or other members' views).
export const secretOverrides = pgTable(
  "secret_overrides",
  {
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    valueEnc: text("value_enc").notNull(),
  },
  (t) => [primaryKey({ columns: [t.secretId, t.userId] })]
)

export const secretTags = pgTable(
  "secret_tags",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("secret_tags_name_idx").on(t.projectId, t.name)]
)

export const secretTagLinks = pgTable(
  "secret_tag_links",
  {
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => secretTags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.secretId, t.tagId] })]
)

// ---- Secrets S2: machine tokens, CLI sign-in, server push, webhooks ----

// Machine tokens (nms_…): only the sha256 is kept. Scoped to some environments and a folder path.
export const secretTokens = pgTable(
  "secret_tokens",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hash: text("hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    envIds: uuid("env_ids").array().notNull(),
    path: text("path").notNull().default(""),
    access: text("access").$type<"ro" | "rw">().notNull().default("ro"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ipAllow: text("ip_allow").array(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastIp: text("last_ip"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // 7 or 1: the last "expires soon" notice sent.
    warnedDays: integer("warned_days"),
  },
  (t) => [index("secret_tokens_project_idx").on(t.projectId)]
)

// CLI sign-ins (nmu_…): act as the member, hash only.
export const secretCliTokens = pgTable(
  "secret_cli_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hash: text("hash").notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastIp: text("last_ip"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("secret_cli_tokens_user_idx").on(t.userId)]
)

// The device-code login (lib/secrets/tokens.ts). status: pending | approved | denied | used.
export const secretDeviceCodes = pgTable("secret_device_codes", {
  id: id(),
  codeHash: text("code_hash").notNull().unique(),
  pollHash: text("poll_hash").notNull().unique(),
  deviceName: text("device_name").notNull(),
  ip: text("ip"),
  status: text("status").notNull().default("pending"),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

// Where an environment's .env is pushed over SSH. keyId (a stored SSH key) wins over keyEnc.
export const secretPushTargets = pgTable("secret_push_targets", {
  envId: uuid("env_id")
    .primaryKey()
    .references(() => secretEnvs.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  path: text("path").notNull(),
  keyEnc: text("key_enc"),
  keyId: uuid("key_id").references((): AnyPgColumn => secretSshKeys.id, { onDelete: "set null" }),
  hostKey: text("host_key"),
  postCommand: text("post_command"),
  auto: boolean("auto").notNull().default(false),
  lastAt: timestamp("last_at", { withTimezone: true }),
  lastOk: boolean("last_ok"),
  lastMessage: text("last_message"),
})

export const secretWebhooks = pgTable(
  "secret_webhooks",
  {
    id: id(),
    envId: uuid("env_id")
      .notNull()
      .references(() => secretEnvs.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("secret_webhooks_env_idx").on(t.envId)]
)

export const secretWebhookDeliveries = pgTable(
  "secret_webhook_deliveries",
  {
    id: id(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => secretWebhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    httpStatus: integer("http_status"),
    message: text("message"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("secret_webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)]
)

// ---- Secrets S3: governance ----

export type CrChange = {
  // The secret's id when it exists; the key and folder path name it otherwise.
  id?: string
  folder: string
  key: string
  action: "set" | "delete"
  // The secret's version when the request was made (0 = didn't exist): a merge refuses when it moved.
  base: number
  valueEnc?: string
  comment?: string | null
  type?: string | null
  rotationAt?: string | null
  tags?: string[]
}

// An edit to a protected environment, held until enough approvers say yes.
export const secretChangeRequests = pgTable(
  "secret_change_requests",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    envId: uuid("env_id")
      .notNull()
      .references(() => secretEnvs.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    source: text("source").notNull(),
    note: text("note"),
    changes: jsonb("changes").$type<CrChange[]>().notNull(),
    status: text("status").$type<"open" | "merged" | "rejected" | "closed">().notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [index("secret_cr_project_idx").on(t.projectId, t.status)]
)

export const secretReviews = pgTable(
  "secret_reviews",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => secretChangeRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    decision: text("decision").$type<"approve" | "reject">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.userId] })]
)

// A flat thread on a secret or on a change request (Phase 14's comments hang off files).
export const secretComments = pgTable(
  "secret_comments",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    secretId: uuid("secret_id").references(() => secrets.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").references(() => secretChangeRequests.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("secret_comments_secret_idx").on(t.secretId), index("secret_comments_request_idx").on(t.requestId)]
)

// Temporary access to an environment: approved until expires_at, then gone.
export const secretAccessRequests = pgTable(
  "secret_access_requests",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    envId: uuid("env_id")
      .notNull()
      .references(() => secretEnvs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<"developer" | "viewer">().notNull(),
    minutes: integer("minutes").notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<"pending" | "approved" | "denied" | "revoked">().notNull().default("pending"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    expiredNotified: boolean("expired_notified").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("secret_access_project_idx").on(t.projectId, t.status), index("secret_access_user_idx").on(t.userId, t.status)]
)

// One-time share links: the text sealed with the server key, only the token's hash kept.
export const secretShares = pgTable(
  "secret_shares",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label"),
    valueEnc: text("value_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxViews: integer("max_views").notNull().default(1),
    views: integer("views").notNull().default(0),
    passwordHash: text("password_hash"),
    fails: integer("fails").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("secret_shares_user_idx").on(t.createdBy, t.createdAt)]
)

// Keys every environment must have, with an optional shape for the value.
export const secretRequiredKeys = pgTable(
  "secret_required_keys",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: text("kind").$type<"any" | "url" | "int" | "regex">().notNull().default("any"),
    pattern: text("pattern"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })]
)

// S4 SSH. Keys: private key (and passphrase) sealed with the project key.
export const secretSshKeys = pgTable(
  "secret_ssh_keys",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    comment: text("comment"),
    privateEnc: text("private_enc").notNull(),
    passphraseEnc: text("passphrase_enc"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("secret_ssh_keys_project_idx").on(t.projectId)]
)

// Host entries. useCa: sign in with a fresh certificate from the project's SSH CA.
export const secretSshHosts = pgTable(
  "secret_ssh_hosts",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(22),
    username: text("username").notNull(),
    keyId: uuid("key_id").references(() => secretSshKeys.id, { onDelete: "set null" }),
    useCa: boolean("use_ca").notNull().default(false),
    jumpHostId: uuid("jump_host_id").references((): AnyPgColumn => secretSshHosts.id, { onDelete: "set null" }),
    hostKey: text("host_key"),
    createdAt: createdAt(),
  },
  (t) => [index("secret_ssh_hosts_project_idx").on(t.projectId)]
)

// One CA per project (ed25519), private key sealed with the project key.
export const secretSshCas = pgTable("secret_ssh_cas", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => secretProjects.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  privateEnc: text("private_enc").notNull(),
  nextSerial: integer("next_serial").notNull().default(1),
  createdAt: createdAt(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
})

export const secretSshCerts = pgTable(
  "secret_ssh_certs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    serial: integer("serial").notNull(),
    keyId: text("key_id").notNull(),
    principals: text("principals").notNull(),
    publicFingerprint: text("public_fingerprint").notNull(),
    caFingerprint: text("ca_fingerprint").notNull(),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("secret_ssh_certs_project_idx").on(t.projectId, t.createdAt)]
)

// S5 PKI. Private keys are sealed with the project key; certificates themselves are public.
export const secretCas = pgTable(
  "secret_cas",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => secretCas.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    certPem: text("cert_pem").notNull(),
    keyEnc: text("key_enc").notNull(),
    subject: text("subject").notNull(),
    notAfter: timestamp("not_after", { withTimezone: true }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("secret_cas_project_idx").on(t.projectId)]
)

export const secretCertTemplates = pgTable(
  "secret_cert_templates",
  {
    id: id(),
    caId: uuid("ca_id")
      .notNull()
      .references(() => secretCas.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<"server" | "client">().notNull(),
    sanPatterns: jsonb("san_patterns").$type<string[]>().notNull(),
    maxTtlDays: integer("max_ttl_days").notNull(),
  },
  (t) => [index("secret_cert_templates_ca_idx").on(t.caId)]
)

// The certificate store: uploaded, issued by a private CA, or issued by ACME.
// acme: how to renew it (account, challenge, DNS credential, auto-renew).
export const secretCerts = pgTable(
  "secret_certs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source").$type<"upload" | "ca" | "acme">().notNull(),
    certPem: text("cert_pem").notNull(),
    chainPem: text("chain_pem").notNull().default(""),
    keyEnc: text("key_enc"),
    subject: text("subject").notNull(),
    issuer: text("issuer").notNull(),
    serial: text("serial").notNull(),
    sans: jsonb("sans").$type<string[]>().notNull(),
    keyType: text("key_type").notNull(),
    fingerprint: text("fingerprint").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    notAfter: timestamp("not_after", { withTimezone: true }).notNull(),
    caId: uuid("ca_id").references(() => secretCas.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: integer("revoke_reason"),
    acme: jsonb("acme").$type<{ accountId: string; domains: string[]; challenge: "http-01" | "dns-01" | "manual"; credId: string | null; autoRenew: boolean; failedAt?: string }>(),
    warnedDays: integer("warned_days"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("secret_certs_project_idx").on(t.projectId), index("secret_certs_ca_idx").on(t.caId)]
)

export const secretAcmeAccounts = pgTable(
  "secret_acme_accounts",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    directory: text("directory").notNull(),
    email: text("email").notNull(),
    keyEnc: text("key_enc").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("secret_acme_accounts_dir_idx").on(t.projectId, t.directory)]
)

export const secretDnsCreds = pgTable(
  "secret_dns_creds",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").$type<"cloudflare" | "route53" | "digitalocean">().notNull(),
    credEnc: text("cred_enc").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("secret_dns_creds_project_idx").on(t.projectId)]
)

// One ACME order in flight. challenges holds what to publish (and the HTTP-01 tokens
// the public route answers with); certId is set when it ends in a certificate.
export const secretAcmeOrders = pgTable(
  "secret_acme_orders",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => secretAcmeAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domains: jsonb("domains").$type<string[]>().notNull(),
    challenge: text("challenge").$type<"http-01" | "dns-01" | "manual">().notNull(),
    credId: uuid("cred_id").references(() => secretDnsCreds.id, { onDelete: "set null" }),
    autoRenew: boolean("auto_renew").notNull().default(true),
    status: text("status").$type<"working" | "awaiting" | "issued" | "failed">().notNull(),
    error: text("error"),
    orderEnc: text("order_enc"),
    keyEnc: text("key_enc"),
    challenges: jsonb("challenges").$type<{ domain: string; type: string; token: string; keyAuth: string; record?: { name: string; value: string }; url: string }[]>().notNull().default([]),
    renewCertId: uuid("renew_cert_id").references(() => secretCerts.id, { onDelete: "cascade" }),
    certId: uuid("cert_id").references(() => secretCerts.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("secret_acme_orders_project_idx").on(t.projectId, t.createdAt)]
)

export const secretWatches = pgTable(
  "secret_watches",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    port: integer("port").notNull().default(443),
    subject: text("subject"),
    issuer: text("issuer"),
    notAfter: timestamp("not_after", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    error: text("error"),
    warnedDays: integer("warned_days"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("secret_watches_target_idx").on(t.projectId, t.host, t.port)]
)

// Typed items. Everything but the name, kind and expiry is in dataEnc (sealed JSON);
// a small file lives there too (base64, 1 MB max), so it rides along with DB backups.
export const secretItems = pgTable(
  "secret_items",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => secretProjects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"login" | "api_key" | "db" | "note" | "file">().notNull(),
    name: text("name").notNull(),
    dataEnc: text("data_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    warnedDays: integer("warned_days"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("secret_items_project_idx").on(t.projectId)]
)
