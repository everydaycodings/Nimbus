import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

import { user } from "./auth-schema"

export * from "./auth-schema"

// ponytail: random uuidv4 keys fragment indexes at scale; switch to uuidv7() on Postgres 18
const id = () => uuid("id").primaryKey().defaultRandom()
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

// Vault keys never reach the server in the clear: the browser wraps the vault key
// with a passphrase-derived key and only the wrapped key and salt are stored.
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
    createdAt: createdAt(),
  },
  (t) => [index("vaults_owner_id_idx").on(t.ownerId)]
)

export const nodeKind = pgEnum("node_kind", ["file", "folder"])

// Files and folders share one tree. parent_id null means the owner's root.
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
    size: bigint("size", { mode: "number" }).notNull().default(0),
    mime: text("mime"),
    s3Key: text("s3_key"),
    starred: boolean("starred").notNull().default(false),
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
    index("nodes_owner_starred_idx")
      .on(t.ownerId)
      .where(sql`${t.starred}`),
    index("nodes_owner_trashed_idx")
      .on(t.ownerId)
      .where(sql`${t.trashedAt} is not null`),
    check(
      "nodes_file_has_key",
      sql`(${t.kind} = 'folder') = (${t.s3Key} is null)`
    ),
    check("nodes_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ]
)

export const shareRole = pgEnum("share_role", ["viewer", "editor"])

// A share targets a user (grantee_id) or is a public link (token), never neither.
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
    token: text("token").unique(),
    role: shareRole("role").notNull().default("viewer"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("shares_node_id_idx").on(t.nodeId),
    index("shares_grantee_id_idx").on(t.granteeId),
    index("shares_created_by_idx").on(t.createdBy),
    check(
      "shares_has_target",
      sql`${t.granteeId} is not null or ${t.token} is not null`
    ),
  ]
)

export const SIGNUP_MODES = ["approval", "invite", "open", "closed"] as const
export type SignupMode = (typeof SIGNUP_MODES)[number]

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
    check("invites_max_uses_positive", sql`${t.maxUses} is null or ${t.maxUses} > 0`),
  ]
)

export type User = typeof user.$inferSelect
export type Role = "owner" | "admin" | "member"
export type Status = "pending" | "active" | "rejected"
