import { z } from "zod"

import { fail, notFound, query, withMember } from "@/lib/api"
import * as svc from "@/lib/services/transcripts"

type Ctx = { params: Promise<{ id: string }> }
const q = z.object({ format: z.enum(["json", "srt", "txt", "vtt"]).default("json") })

// What was said in a video or audio file. ?format=json (default, a TranscriptResponse) or a
// download: srt, txt, vtt. 404 when there is no transcript to download.
export const GET = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const p = query(req, q)
    if (p instanceof Response) return p
    const id = (await params).id
    if (p.format === "json") {
      const t = await svc.transcript(me, id)
      return t ? Response.json(t.res) : notFound("That file")
    }
    const file = await svc.transcriptFile(me, id, p.format)
    return file
      ? new Response(file.body, {
          headers: {
            "Content-Type": `${file.type}; charset=utf-8`,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          },
        })
      : notFound("That transcript")
  })

// Owner only: transcribe the file again (the worker picks it up). 204.
export const POST = (_: Request, { params }: Ctx) =>
  withMember(async (me) =>
    (await svc.redoTranscript(me, (await params).id))
      ? new Response(null, { status: 204 })
      : fail(403, "forbidden", "Only the owner can have it transcribed again.")
  )
