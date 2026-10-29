import { getStream } from "@/lib/s3"
import { getSession } from "@/lib/session"

const notFound = () => new Response("Not found", { status: 404 })

// Uploaded avatars, for anyone signed in. A new upload gets a new key, so the
// response never changes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params
  if (!/^[\w-]+$/.test(key) || !(await getSession())) return notFound()
  try {
    return new Response(await getStream(`avatars/${key}.jpg`), {
      headers: {
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch {
    return notFound()
  }
}
