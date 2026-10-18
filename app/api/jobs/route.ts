// The worker (scripts/worker.ts) hands queued and scheduled jobs here, because
// they reuse the app's database, storage and email code. Anything but a 2xx
// makes the worker try the job again later.
import { sendNow, type Message } from "@/lib/email"
import { purgeExpiredTrash } from "@/lib/files"
import { removeObjects } from "@/lib/s3"
import { readToken } from "@/lib/upload-rules"
import { finishTusUpload } from "@/lib/uploads"

const jobs: Record<string, (data: never) => Promise<unknown>> = {
  purge: purgeExpiredTrash,
  email: (m: Message) => sendNow(m),
  "delete-keys": ({ keys }: { keys: string[] }) => removeObjects(keys),
  // An error here (not ours, gone) won't fix itself; only a throw is retried.
  "tus-finish": async ({ id }: { id: string }) => {
    const done = await finishTusUpload(id)
    if (done.error) console.error("tus-finish", id, done.error)
  },
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "")
  const t = readToken("job", token)
  if (!t || t.exp < Date.now()) return new Response(null, { status: 401 })
  const { name, data } = (await req.json()) as { name: string; data: never }
  const run = jobs[name]
  if (!run) return new Response(`No job called ${name}.`, { status: 400 })
  try {
    await run(data)
  } catch (e) {
    console.error(`[job] ${name}:`, e)
    return new Response((e as Error).message, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
