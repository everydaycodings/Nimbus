"use server"

import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import {
  INTERVALS,
  KINDS,
  PROVIDERS,
  isTimeZone,
  type Kind,
  type Provider,
  type Retention,
} from "@/lib/backup-rules"
import { client, testDest, type Dest } from "@/lib/backup/dest"
import { requireUnlocked, sendCode, verify } from "@/lib/backup/reauth"
import { destOf } from "@/lib/backup/status"
import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { backupNotes, backupRuns, settings } from "@/lib/db/schema"
import { enqueueBackup, scheduleBackups } from "@/lib/redis"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export type FormState = { ok?: boolean; error?: string } | null

const PATH = "/admin/system/backups"
const done = () => revalidatePath(PATH, "layout")

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim()

const whole = (form: FormData, name: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(form.get(name)))
  return Number.isFinite(n) && String(form.get(name) ?? "") !== ""
    ? Math.min(Math.max(n, min), max)
    : fallback
}

const isKind = (k: string): k is Kind => KINDS.includes(k as Kind)

// ---- Runs -----------------------------------------------------------------

// Opens the run here so the page shows it at once; the worker picks it up.
export async function startBackup(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireAdmin()
  const kind = field(form, "kind")
  if (!isKind(kind)) return { error: "Pick what to back up." }
  const note = field(form, "note").slice(0, 2000)
  const pin = form.get("pin") === "on"
  let id: string
  try {
    ;[{ id }] = await db
      .insert(backupRuns)
      .values({ kind, trigger: "manual", actorId: me.id, pinned: pin })
      .returning({ id: backupRuns.id })
  } catch {
    return { error: "A backup of this kind is already running." }
  }
  const notes = [
    ...(note ? [{ kind: "note" as const, body: note }] : []),
    ...(pin ? [{ kind: "pin" as const, body: "" }] : []),
  ]
  if (notes.length)
    await db.insert(backupNotes).values(notes.map((n) => ({ ...n, runId: id, userId: me.id })))
  try {
    await enqueueBackup({ kind, trigger: "manual", runId: id })
  } catch {
    await db
      .update(backupRuns)
      .set({ status: "failed", finishedAt: new Date(), error: "Redis isn't reachable, so the worker never got this run." })
      .where(eq(backupRuns.id, id))
    return { error: "Redis isn't reachable, so the backup couldn't be queued." }
  }
  done()
  return { ok: true }
}

export async function reverify(runId: string) {
  const me = await requireAdmin()
  const [src] = await db.select().from(backupRuns).where(eq(backupRuns.id, runId))
  if (!src?.s3Key || src.deletedAt || src.kind !== "db") return
  try {
    const [{ id }] = await db
      .insert(backupRuns)
      .values({ kind: "db", trigger: "reverify", sourceRunId: runId, actorId: me.id })
      .returning({ id: backupRuns.id })
    await enqueueBackup({ kind: "db", trigger: "reverify", runId: id })
  } catch {
    // Another database run holds the slot; the button says to wait.
  }
  done()
}

export async function setPin(runId: string, pinned: boolean) {
  const me = await requireAdmin()
  await db.update(backupRuns).set({ pinned }).where(eq(backupRuns.id, runId))
  await db.insert(backupNotes).values({ runId, userId: me.id, kind: pinned ? "pin" : "unpin" })
  done()
}

export async function addNote(runId: string, form: FormData) {
  const me = await requireAdmin()
  const body = field(form, "note").slice(0, 2000)
  if (!body) return
  await db.insert(backupNotes).values({ runId, userId: me.id, kind: "note", body })
  done()
}

// A link to the encrypted dump, good for 5 minutes. Needs a fresh re-auth,
// and leaves a note on the run saying who took it.
export async function downloadUrl(runId: string): Promise<{ url?: string; error?: string }> {
  const me = await requireAdmin()
  try {
    await requireUnlocked()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const [run] = await db
    .select()
    .from(backupRuns)
    .where(and(eq(backupRuns.id, runId), eq(backupRuns.kind, "db")))
  if (!run?.s3Key || run.deletedAt) return { error: "That backup's file is no longer in storage." }
  const { dest, error } = destOf(await getSettings())
  if (!dest) return { error: error ?? "Backup storage isn't set up." }
  const url = await getSignedUrl(
    client(dest),
    new GetObjectCommand({
      Bucket: dest.bucket,
      Key: run.s3Key,
      ResponseContentDisposition: `attachment; filename="${run.s3Key.split("/").pop()}"`,
    }),
    { expiresIn: 300 }
  )
  await db.insert(backupNotes).values({ runId, userId: me.id, kind: "note", body: "Downloaded the file." })
  done()
  return { url }
}

// ---- Settings -------------------------------------------------------------

async function reschedule() {
  // Saved either way; the worker also catches up within 5 minutes.
  await scheduleBackups(await getSettings()).catch(() => {})
}

export async function setPaused(paused: boolean) {
  await requireAdmin()
  await db.update(settings).set({ backupPaused: paused, updatedAt: new Date() })
  await reschedule()
  done()
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export async function saveSchedules(form: FormData) {
  await requireAdmin()
  const hours = (name: string, fallback: number) => {
    const n = Number(form.get(name))
    return INTERVALS.includes(n as (typeof INTERVALS)[number]) ? n : fallback
  }
  const time = (name: string, fallback: string) => {
    const v = field(form, name)
    return TIME.test(v) ? v : fallback
  }
  const tz = field(form, "tz")
  await db.update(settings).set({
    backupDbEnabled: form.get("dbEnabled") === "on",
    backupDbIntervalH: hours("dbInterval", 6),
    backupDbStart: time("dbStart", "03:00"),
    backupFilesEnabled: form.get("filesEnabled") === "on",
    backupFilesIntervalH: hours("filesInterval", 24),
    backupFilesStart: time("filesStart", "02:00"),
    ...(isTimeZone(tz) && { backupTz: tz }),
    updatedAt: new Date(),
  })
  await reschedule()
  done()
}

export async function saveRetention(form: FormData) {
  await requireAdmin()
  const r: Retention =
    field(form, "mode") === "newest"
      ? { mode: "last_n", keepLast: whole(form, "keepLast", 1, 10_000, 30) }
      : {
          mode: "tiered",
          hours: whole(form, "hours", 0, 24 * 30, 48),
          days: whole(form, "days", 0, 3650, 30),
          weeks: whole(form, "weeks", 0, 520, 12),
          months: whole(form, "months", 0, 240, 12),
        }
  await db.update(settings).set({ backupRetention: r, updatedAt: new Date() })
  done()
}

export async function saveFiles(form: FormData) {
  await requireAdmin()
  await db.update(settings).set({
    backupFilesEncrypt: form.get("encrypt") === "on",
    backupFilesGraceDays: whole(form, "grace", 1, 3650, 30),
    backupFilesConcurrency: whole(form, "concurrency", 1, 32, 4),
    backupFilesSamplePct: whole(form, "sample", 0, 100, 1),
    updatedAt: new Date(),
  })
  done()
}

export async function saveAlerts(form: FormData) {
  await requireAdmin()
  const shrink = field(form, "shrink")
  await db.update(settings).set({
    backupAlerts: (["failure", "warning", "stale"] as const).filter((e) => form.get(`alert:${e}`) === "on"),
    backupRetryAttempts: whole(form, "retries", 0, 10, 1),
    backupRetryDelayMin: whole(form, "retryDelay", 1, 24 * 60, 15),
    backupShrinkWarnPct: shrink ? whole(form, "shrink", 1, 99, 20) : null,
    updatedAt: new Date(),
  })
  done()
}

// The storage form as a destination. Blank keys fall back to the saved ones.
async function destFrom(form: FormData): Promise<Dest | string> {
  const provider = field(form, "provider") as Provider
  if (!PROVIDERS.includes(provider)) return "Pick a storage provider."
  const bucket = field(form, "bucket")
  if (!bucket) return "Enter the bucket's name."
  const endpoint = field(form, "endpoint")
  if (endpoint && !/^https?:\/\/\S+$/.test(endpoint))
    return "The endpoint must start with https:// (or http:// on a private network)."
  if (provider !== "aws" && !endpoint) return "Enter the provider's endpoint URL."
  const saved = destOf(await getSettings()).dest
  return {
    provider,
    endpoint: endpoint || null,
    region: field(form, "region") || "us-east-1",
    bucket,
    folder: field(form, "folder").replace(/^\/+|\/+$/g, ""),
    pathStyle: form.get("pathStyle") === "on",
    accessKey: field(form, "accessKey") || (saved?.fromEnv ? null : saved?.accessKey ?? null),
    secretKey: String(form.get("secretKey") ?? "") || (saved?.fromEnv ? null : saved?.secretKey ?? null),
    fromEnv: false,
  }
}

const s3Error = (e: unknown) => {
  const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
  const status = err.$metadata?.httpStatusCode
  if (status === 403 || err.name === "AccessDenied" || err.name === "InvalidAccessKeyId" || err.name === "SignatureDoesNotMatch")
    return "The keys were refused. Check the access key, secret, and that they can write to this bucket."
  if (status === 404 || err.name === "NoSuchBucket" || err.name === "NotFound")
    return "That bucket doesn't exist, or the region or endpoint is wrong."
  return `The bucket didn't answer: ${err.message || err.name || "no reason given"}.`
}

export async function testStorage(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const d = await destFrom(form)
  if (typeof d === "string") return { error: d }
  try {
    await testDest(d)
    return { ok: true }
  } catch (e) {
    return { error: s3Error(e) }
  }
}

export async function saveStorage(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  if (process.env.BACKUP_S3_BUCKET)
    return { error: "Storage is set in env, so it can't be changed here." }
  try {
    await requireUnlocked()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const d = await destFrom(form)
  if (typeof d === "string") return { error: d }
  try {
    await testDest(d)
  } catch (e) {
    return { error: `Not saved. ${s3Error(e)}` }
  }
  await db.update(settings).set({
    backupProvider: d.provider,
    backupEndpoint: d.endpoint,
    backupRegion: d.region,
    backupBucket: d.bucket,
    backupFolder: d.folder,
    backupPathStyle: d.pathStyle,
    backupAccessKey: d.accessKey ? encrypt(d.accessKey) : null,
    backupSecretKey: d.secretKey ? encrypt(d.secretKey) : null,
    updatedAt: new Date(),
  })
  done()
  return { ok: true }
}

// ---- Re-auth --------------------------------------------------------------

export async function confirmIdentity(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const error = await verify(String(form.get("secret") ?? ""))
  if (error) return { error }
  done()
  return { ok: true }
}

export async function emailCode(): Promise<FormState> {
  await requireAdmin()
  const error = await sendCode()
  return error ? { error } : { ok: true }
}
