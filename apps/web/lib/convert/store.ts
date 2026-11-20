// The worker has made a converted file and put it in the bucket (scripts/convert.ts); this makes it a file next to the original.
// Called through /api/jobs ("convert-finish"). It doesn't go through lib/store-file.ts, so a watch folder never sees its own outputs.
import "server-only"

import { and, eq } from "drizzle-orm"

import { recordSaved } from "@/lib/activity"
import { db } from "@/lib/db"
import { convertJobs, nodes } from "@/lib/db/schema"
import { mimeFor } from "@/lib/store-file"
import { notify } from "@/lib/notify"
import { checkStorage, spaceLeft } from "@/lib/quota"
import { enqueueDerive } from "@/lib/redis"
import { deleteKeys } from "@/lib/s3"
import { pruneVersions, rejectReason, saveUploaded, uploadLimits } from "@/lib/uploads"
import { outName } from "./rules.ts"

// Marks a job failed (only while it is running) and tells the member.
export async function failJob(jobId: string, error: string) {
  const [j] = await db
    .update(convertJobs)
    .set({ status: "failed", error: error.slice(0, 300), etaSec: null, finishedAt: new Date() })
    .where(and(eq(convertJobs.id, jobId), eq(convertJobs.status, "running")))
    .returning({ userId: convertJobs.userId, name: convertJobs.inputName })
  if (j) await notify(j.userId, "convert_done", { data: { name: j.name, error: error.slice(0, 200) } })
}

export async function finishConvert({ jobId, key, size }: { jobId: string; key: string; size: number }) {
  const [j] = await db.select().from(convertJobs).where(eq(convertJobs.id, jobId))
  // Cancelled or gone while it ran: nothing points at the object.
  if (!j || j.status !== "running") return void (await deleteKeys([key]))
  const [src] = j.inputNodeId ? await db.select({ parentId: nodes.parentId }).from(nodes).where(eq(nodes.id, j.inputNodeId)) : []
  if (!src) {
    await deleteKeys([key])
    return failJob(jobId, "The original file is gone.")
  }
  const name = outName(j.inputName, j.presetName, j.preset)
  const left = await spaceLeft(j.userId)
  const why = rejectReason(name, size, await uploadLimits()) ?? (left !== null && size > left ? "Not enough storage space for the converted file." : null)
  if (why) {
    await deleteKeys([key])
    return failJob(jobId, why)
  }
  const mime = mimeFor(name)
  const saved = await db.transaction((tx) =>
    saveUploaded(tx, { ownerId: j.userId, parentId: src.parentId, name, version: { s3Key: key, size, mime, uploadedBy: j.userId }, onConflict: "keep" })
  )
  if (!saved.nodeId) {
    await deleteKeys([key])
    return failJob(jobId, saved.error ?? "Couldn't save the converted file.")
  }
  const [out] = await db.select({ name: nodes.name }).from(nodes).where(eq(nodes.id, saved.nodeId))
  await recordSaved(saved.nodeId, saved.versionId!, j.userId, "converted")
  await pruneVersions(saved.nodeId)
  await checkStorage(j.userId)
  await enqueueDerive(saved.versionId!)
  await db
    .update(convertJobs)
    .set({ status: "done", progress: 100, etaSec: null, outputNodeId: saved.nodeId, outputName: out.name, finishedAt: new Date() })
    .where(eq(convertJobs.id, jobId))
  // A watch folder converting a pile of photos would flood the bell: only long jobs and hand-started ones ring it.
  if (!(j.watchId && j.preset.kind === "image"))
    await notify(j.userId, "convert_done", { nodeId: saved.nodeId, data: { name: j.inputName, to: out.name } })
}
