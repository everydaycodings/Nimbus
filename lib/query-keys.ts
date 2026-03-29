// lib/query-keys.ts
// Centralized query key factory — keeps cache keys consistent across the app

export const queryKeys = {
  // Base key for all file/folder data — use for mass invalidation
  all: ["files"] as const,

  // Files + folders in a specific parent folder, with filter options
  files: (
    parentFolderId: string | null,
    options?: object
  ) => ["files", "list", parentFolderId, options] as const,

  // Recent files
  recent: (options?: object) =>
    ["files", "recent", options] as const,

  // Starred items
  starred: (options?: object) =>
    ["files", "starred", options] as const,

  // Trashed items
  trash: () => ["files", "trash"] as const,
};
