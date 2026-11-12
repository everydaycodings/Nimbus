// Who sees what in the activity feed, and how long it's kept. No imports, so node --test can run it.
export const ACTIVITY_TYPES = ["upload", "version", "rename", "move", "share", "trash", "restore", "comment"] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

// Days an admin may pick; null keeps everything.
export const ACTIVITY_RETENTION = [30, 90, 365, null] as const
export const DEFAULT_ACTIVITY_DAYS = 90
export const ACTIVITY_LIMIT = 50

// Owners see everything on their files. Anyone else sees the changes to what they can open, but not who
// it was shared with: that list is the owner's (and the sharer's) business.
export const visibleTypes = (role: "owner" | "editor" | "viewer"): ActivityType[] =>
  role === "owner" ? [...ACTIVITY_TYPES] : ACTIVITY_TYPES.filter((t) => t !== "share")

// Events older than this go. Null: keep them all.
export const retentionCutoff = (days: number | null, now = Date.now()) =>
  days && days > 0 ? new Date(now - days * 86_400_000) : null
