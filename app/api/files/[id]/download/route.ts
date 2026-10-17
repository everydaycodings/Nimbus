import { openableFile } from "@/lib/files"
import { headSize, presignGet } from "@/lib/s3"
import { memberOrNull } from "@/lib/session"

const notFound = () => new Response("Not found", { status: 404 })

// 302 to a presigned S3 URL. ?v= picks an older version.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await memberOrNull()
  if (!me) return new Response("Sign in first", { status: 401 })
  const { id } = await params
  const v = new URL(req.url).searchParams.get("v")
  const file = await openableFile(me.id, id, v)
  if (!file || (await headSize(file.key)) === null) return notFound()
  return Response.redirect(await presignGet(file.key, file.name), 302)
}
