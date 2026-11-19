// What an access key may do, shared by the protocol checks and the key dialog. Pure.
export const PERMS = ["list", "read", "write", "delete"] as const
export type Perm = (typeof PERMS)[number]

export const PRESETS = {
  read: { label: "Read only", hint: "List and download. Nothing can change.", perms: ["list", "read"] },
  rw: { label: "Read & write", hint: "Everything, including delete.", perms: ["list", "read", "write", "delete"] },
  append: { label: "Append only", hint: "List, download and upload. Can't delete; an overwrite keeps the old version.", perms: ["list", "read", "write"] },
} as const satisfies Record<string, { label: string; hint: string; perms: readonly Perm[] }>

// The preset these permissions are exactly, or "custom".
export function presetOf(perms: readonly string[]): keyof typeof PRESETS | "custom" {
  for (const [k, p] of Object.entries(PRESETS))
    if (p.perms.length === perms.length && p.perms.every((x) => perms.includes(x))) return k as keyof typeof PRESETS
  return "custom"
}

export const permsLabel = (perms: readonly string[]) => {
  const p = presetOf(perms)
  return p === "custom" ? PERMS.filter((x) => perms.includes(x)).join(", ") : PRESETS[p].label
}

// The old rw/ro column, kept in step for now.
export const legacyAccess = (perms: readonly string[]) => (perms.includes("write") ? "rw" : "ro")

export const MAX_PREFIX = 512
export const MAX_IPS = 20
export const MAX_ROTATE_DAYS = 3650
// Seconds the old secret keeps working after a rotation.
export const GRACES = [0, 3600, 86_400, 604_800] as const
export const EXPIRING_SOON_DAYS = 7

export const prefixError = (p: string) =>
  p.startsWith("/")
    ? "Leave off the leading slash: write photos/2024/, not /photos/2024/."
    : p.length > MAX_PREFIX || /[\0\\]/.test(p)
      ? "That prefix isn't valid."
      : null
