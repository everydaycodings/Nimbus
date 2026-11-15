// Build secrets: references into Nimbus Secrets (project, secret id, key), never values. Saving a rule
// checks the saver can read each one; the runner gets the values at run time (systemCtx), in memory only.
import "server-only"

import { exportPairs, projectCtx, systemCtx } from "@/lib/secrets/service"
import { unlockState } from "@/lib/secrets/unlock"

type Ref = { id: string; projectId: string; env: string; key: string }

const byProject = (refs: Ref[]) => {
  const m = new Map<string, Ref[]>()
  for (const r of refs) m.set(r.projectId, [...(m.get(r.projectId) ?? []), r])
  return m
}

// Error text, or null when the member may read every referenced secret (and Secrets is unlocked for them).
export async function checkRefs(userId: string, refs: Ref[]): Promise<string | null> {
  if (!refs.length) return null
  const st = await unlockState(false).catch(() => null)
  if (!st || st.userId !== userId || !st.unlocked) return "Unlock Secrets first to use build secrets."
  for (const [projectId, rs] of byProject(refs)) {
    const c = await projectCtx(userId, projectId).catch(() => null)
    if (!c) return "You aren't a member of the project one of the build secrets comes from."
    const pairs = await exportPairs(c, { ids: rs.map((r) => r.id) }, { expand: false, own: false })
    for (const r of rs) if (!pairs.some((p) => p.key === r.key)) return `You can't read the secret ${r.key}, or it no longer exists.`
  }
  return null
}

// key -> value for the runner. Throws with a plain message when a secret is gone.
export async function resolveRefs(refs: Ref[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [projectId, rs] of byProject(refs)) {
    const c = await systemCtx(projectId)
    if (!c) throw new Error("A project with a build secret was deleted.")
    const pairs = await exportPairs(c, { ids: rs.map((r) => r.id) }, { expand: true, own: false })
    for (const r of rs) {
      const p = pairs.find((x) => x.key === r.key)
      if (!p) throw new Error(`The build secret ${r.key} no longer exists.`)
      out[r.key] = p.value
    }
  }
  return out
}
