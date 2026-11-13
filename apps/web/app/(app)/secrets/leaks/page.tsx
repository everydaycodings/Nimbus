import { LeaksView } from "@/components/secrets/leaks-view"
import { pageUnlocked } from "@/lib/secrets/page"
import { listProjects } from "@/lib/secrets/service"

export const metadata = { title: "Leaks · Secrets · Nimbus" }

export default async function LeaksPage() {
  const me = await pageUnlocked()
  if (!me) return null
  const projects = await listProjects(me.id)
  return <LeaksView projects={projects.filter((p) => p.role !== "viewer").map((p) => ({ id: p.id, name: p.name }))} />
}
