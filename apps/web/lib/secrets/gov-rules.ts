// Governance rules with no database in them, so node --test can load them:
// value schemas, the change timeline, the rollback plan and review counting.

export type SchemaKind = "any" | "url" | "int" | "regex"

// An error to show, or null when the value fits. Empty is fine (the Overview flags it).
export function checkSchema(kind: SchemaKind, pattern: string | null | undefined, value: string) {
  if (kind === "any" || value === "") return null
  const t = value.trim()
  if (kind === "int") return /^-?\d+$/.test(t) ? null : "Must be a whole number."
  if (kind === "url") {
    try {
      const u = new URL(t)
      return u.protocol && u.host ? null : "Must be a URL."
    } catch {
      return "Must be a URL."
    }
  }
  try {
    return new RegExp(pattern ?? "").test(value) ? null : `Must match ${pattern}.`
  } catch {
    return "The required pattern isn't a valid expression."
  }
}

export function validPattern(pattern: string) {
  try {
    new RegExp(pattern)
    return pattern.length <= 200
  } catch {
    return false
  }
}

// ---- Timeline -------------------------------------------------------------

export type VersionRow = { by: string | null; at: Date; action: string; key: string }
export type Moment = {
  at: string
  by: string | null
  counts: Record<string, number>
  keys: string[]
}

// One save writes its version rows in one transaction, so they share a time.
// Rows from one person within 3 seconds are one moment. `rows` newest first.
export function groupTimeline(rows: VersionRow[]): Moment[] {
  const out: Moment[] = []
  let last: Date | null = null
  for (const r of rows) {
    const cur = out[out.length - 1]
    if (cur && cur.by === r.by && last && last.getTime() - r.at.getTime() <= 3000) {
      cur.counts[r.action] = (cur.counts[r.action] ?? 0) + 1
      if (!cur.keys.includes(r.key)) cur.keys.push(r.key)
    } else out.push({ at: r.at.toISOString(), by: r.by, counts: { [r.action]: 1 }, keys: [r.key] })
    last = r.at
  }
  return out
}

// ---- Rollback ---------------------------------------------------------------

export type Shape = { key: string; folder: string; value: string; comment: string | null; type: string | null }
export type RollbackStep =
  | { kind: "add"; id: string; to: Shape }
  | { kind: "change"; id: string; from: Shape; to: Shape; fields: string[] }
  | { kind: "delete"; id: string; from: Shape }

// `then`: each secret's shape at the chosen moment (null: it didn't exist or was deleted).
// `now`: the live ones. A live secret keeps its folder; only value, comment, type and key go back.
export function planRollback(then: Map<string, Shape | null>, now: Map<string, Shape>): RollbackStep[] {
  const steps: RollbackStep[] = []
  for (const [id, t] of then) {
    const n = now.get(id)
    if (t && !n) steps.push({ kind: "add", id, to: t })
    else if (t && n) {
      const fields = (["key", "value", "comment", "type"] as const).filter((f) => (t[f] ?? null) !== (n[f] ?? null))
      if (fields.length) steps.push({ kind: "change", id, from: n, to: { ...t, folder: n.folder }, fields })
    }
  }
  for (const [id, n] of now) if (!then.has(id) || then.get(id) === null) steps.push({ kind: "delete", id, from: n })
  return steps.sort((a, b) => (a.kind === "add" ? a.to.key : a.from.key).localeCompare(b.kind === "add" ? b.to.key : b.from.key))
}

// ---- Reviews ---------------------------------------------------------------

export type ReviewState = "pending" | "approved" | "rejected"

// Rejections win; otherwise enough approvals from people allowed to approve (never the author).
export function reviewState(
  required: number,
  approvers: Set<string> | null,
  author: string | null,
  reviews: { userId: string; decision: "approve" | "reject" }[]
): ReviewState {
  const valid = reviews.filter((r) => r.userId !== author && (!approvers || approvers.has(r.userId)))
  if (valid.some((r) => r.decision === "reject")) return "rejected"
  return valid.filter((r) => r.decision === "approve").length >= Math.max(1, required) ? "approved" : "pending"
}

// ---- Durations --------------------------------------------------------------

export const ACCESS_MAX_MINUTES = 30 * 24 * 60
export const accessMinutes = (n: unknown) => {
  const m = Math.floor(Number(n))
  return Number.isFinite(m) && m >= 15 && m <= ACCESS_MAX_MINUTES ? m : null
}
export const SHARE_MAX_MINUTES = 30 * 24 * 60
export const shareMinutes = (n: unknown) => {
  const m = Math.floor(Number(n))
  return Number.isFinite(m) && m >= 60 && m <= SHARE_MAX_MINUTES ? m : null
}
