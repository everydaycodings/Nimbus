// The rules behind a project's health score. Pure (relative imports only): the server
// feeds it decrypted values, and only the verdicts ever leave it.
import { createHash } from "node:crypto"

import { entropy } from "./leak-rules.ts"

// Names that hold credentials, not settings.
export const isCredentialKey = (key: string) => /pass|secret|token|key|pwd|credential|auth|private|salt|signing/i.test(key)

const COMMON = new Set(["password", "password1", "123456", "12345678", "qwerty", "admin", "letmein", "welcome", "changeme", "secret", "test", "default", "root", "iloveyou", "p@ssw0rd", "abc123"])

// Why a credential value is weak, or null. References and typed non-credentials are skipped.
export function weakReason(key: string, value: string, type: string | null): string | null {
  if (!value || !isCredentialKey(key)) return null
  if (type && !["string", "pem"].includes(type) && type !== null) return null
  if (type === "pem" || /^\s*-----BEGIN /.test(value) || /\$\{/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  if (COMMON.has(value.toLowerCase())) return "A common password"
  if (value.length < 12) return `Only ${value.length} characters`
  if (entropy(value) < 2.8) return "Repetitive, easy to guess"
  if (/^[a-z]+$/i.test(value) || /^\d+$/.test(value)) return "One kind of character"
  return null
}

export const valueHash = (v: string) => createHash("sha256").update(v).digest("hex")

// Groups of credentials that hold the same value: `where` names each place.
export function reusedGroups<T extends { key: string; value: string; type: string | null }>(items: T[]) {
  const by = new Map<string, T[]>()
  for (const i of items) {
    if (i.value.length < 8 || !isCredentialKey(i.key) || (i.type && !["string", "pem"].includes(i.type))) continue
    if (/\$\{/.test(i.value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(i.value)) continue
    const h = valueHash(i.value)
    by.set(h, [...(by.get(h) ?? []), i])
  }
  return [...by.values()].filter((g) => g.length > 1)
}

export type Counts = { weak: number; reused: number; old: number; missing: number; drift: number; expiring: number; unused: number; leaks: number }

// 100 and down. Each problem kind costs a little per finding up to a cap, so one noisy
// kind can't zero the score on its own.
export function healthScore(n: Counts) {
  const cost = (count: number, each: number, cap: number) => Math.min(cap, count * each)
  const lost =
    cost(n.weak, 4, 25) + cost(n.reused, 5, 20) + cost(n.old, 1, 10) + cost(n.missing, 4, 20) + cost(n.drift, 2, 10) + cost(n.expiring, 5, 20) + cost(n.unused, 2, 8) + cost(n.leaks, 8, 24)
  return Math.max(0, 100 - lost)
}

export const grade = (score: number) => (score >= 90 ? "Healthy" : score >= 70 ? "Fair" : score >= 40 ? "Needs attention" : "At risk")
