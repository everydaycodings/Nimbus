import { ProjectView } from "@/components/secrets/project-view"
import { pageProject } from "@/lib/secrets/page"
import { projectDetail } from "@/lib/secrets/service"

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ view?: string; folder?: string; request?: string }>
}) {
  const { projectId } = await params
  const { view, folder, request } = await searchParams
  const p = await pageProject(projectId)
  if (!p) return null
  const detail = await projectDetail(p.c)
  return <ProjectView detail={detail} initialView={view ?? "overview"} initialFolder={folder ?? ""} initialRequest={request ?? null} />
}
