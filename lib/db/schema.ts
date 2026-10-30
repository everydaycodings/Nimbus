import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  customType,
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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("file_versions_node_number_idx").on(t.nodeId, t.number),
    index("file_versions_node_id_idx").on(t.nodeId),
    index("file_versions_s3_key_idx").on(t.s3Key),
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
      sql`${t.color} in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray')`
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
      .$type<"view" | "download" | "upload" | "unlock_fail">()
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

export const AUTH_EVENT_KINDS = [
  "added",
  "switched",
  "signed_out",
  "saved_login_used",
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
  "signup_request",
  "service_health",
  "backup",
  "app_password",
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
    // Uploads. Null means no limit.
    maxUploadBytes: bigint("max_upload_bytes", { mode: "number" }),
    // Storage each member gets unless they have their own. Null: unlimited.
    defaultQuotaBytes: bigint("default_quota_bytes", { mode: "number" }),
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
    // Tesseract languages for reading text in images, joined with "+".
    ocrLangs: text("ocr_langs").notNull().default("eng"),
    // Vaults. Off stops new vaults; existing ones keep working. Null cap: no limit.
    vaultsEnabled: boolean("vaults_enabled").notNull().default(true),
    maxVaultsPerMember: integer("max_vaults_per_member"),
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
    // Mounting files over WebDAV at /dav with app passwords.
    webdav: boolean("webdav").notNull().default(true),
    // Rules for new passwords and vault passphrases. Null: the owner hasn't
    // chosen, so the industry-standard defaults apply (lib/password-policy).
    passwordPolicy: jsonb("password_policy").$type<PasswordPolicy>(),
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
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("node_content_tsv_idx").using("gin", t.tsv)]
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
