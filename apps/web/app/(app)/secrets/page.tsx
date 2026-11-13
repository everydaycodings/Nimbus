import { ProjectGrid } from "@/components/secrets/project-grid"
import { pageUnlocked } from "@/lib/secrets/page"
import { listProjects, projectLimitHit } from "@/lib/secrets/service"

export default async function SecretsPage() {
  const me = await pageUnlocked()
  if (!me) return null
  const [projects, limit] = await Promise.all([listProjects(me.id), projectLimitHit(me.id)])
  return <ProjectGrid projects={projects} limit={limit} />
}
