// The one selection a cleanup policy makes, used by both the dry-run preview and the
// real run (policy.ts), so what the preview lists is exactly what runs. Pure.
import { evaluatePolicy, matchPattern, untaggedToDelete, type Policy, type PolicyTag } from "./rules.ts"

export type CleanupManifest = { digest: string; createdAt: Date; tagged: boolean; protectedBy: boolean }

// Immutable tags are never selected. Untagged manifests that something else needs
// (an index's child, a referrer of another manifest) are never selected either.
// keepLast on its own means "keep the newest N, drop the rest" (evaluatePolicy only
// applies it to tags a delete rule picked), so the overflow is added here; keepPattern still saves a tag.
function overflow(policy: Policy, tags: PolicyTag[]) {
  if (!policy.keepLast || policy.keepLast <= 0) return []
  return [...tags]
    .sort((a, b) => b.pushedAt.getTime() - a.pushedAt.getTime())
    .slice(policy.keepLast)
    .map((t) => t.name)
    .filter((n) => !(policy.keepPattern && matchPattern(policy.keepPattern, n)))
}

export function selectCleanup(
  policy: Policy,
  tags: PolicyTag[],
  manifests: CleanupManifest[],
  immutablePattern: string | null,
  now: Date = new Date()
) {
  return {
    tags: [...new Set([...evaluatePolicy(policy, tags, now), ...overflow(policy, tags)])].filter((t) => !(immutablePattern && matchPattern(immutablePattern, t))),
    untagged: untaggedToDelete(
      policy,
      manifests.filter((m) => !m.protectedBy),
      now
    ),
  }
}
