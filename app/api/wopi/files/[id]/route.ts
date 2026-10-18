// WOPI CheckFileInfo for the Collabora viewer. Access is rechecked on every
// call, so removing a share closes an open document.
import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { openableFile } from "@/lib/files"
import { readWopi } from "@/lib/office"
import { headSize } from "@/lib/s3"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const t = readWopi(new URL(req.url).searchParams.get("access_token"), id)
  const file = t && (await openableFile(t.u, id, t.v))
  const size = file && (await headSize(file.key))
  if (!t || !file || size === null)
    return new Response("Not found", { status: 404 })
  const [me] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, t.u))
  return Response.json({
    BaseFileName: file.name,
    Size: size,
    OwnerId: file.ownerId,
    UserId: t.u,
    UserFriendlyName: me?.name ?? "",
    Version: file.versionId ?? "",
    UserCanWrite: false,
    ReadOnly: true,
    HideSaveOption: true,
    UserCanNotWriteRelative: true,
  })
}
