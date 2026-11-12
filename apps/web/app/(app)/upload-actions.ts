"use server"

import { refresh } from "next/cache"

import * as svc from "@/lib/services/uploads"
import { requireMember } from "@/lib/session"

export type {
  Conflict,
  Plan,
  UploadEntry,
  Version,
  ZipManifest,
} from "@/lib/services/uploads"

export async function planUpload(
  parentId: string | null,
  entries: svc.UploadEntry[]
): Promise<svc.Plan> {
  return svc.planUpload(await requireMember(), parentId, entries)
}

// Makes these folders (mkdir -p, relative to parentId), reusing existing ones.
// Used for empty folders in a folder upload.
export async function createFolders(
  parentId: string | null,
  paths: string[]
): Promise<{ error?: string }> {
  const r = await svc.createFolders(await requireMember(), parentId, paths)
  if (!r.error) refresh()
  return r
}

// Idempotent: turns a finished tus upload into a node or a new version. The
// tusd post-finish hook calls the same logic, so whichever runs first wins.
export async function finishUpload(uploadUrl: string, sha256?: string | null) {
  const r = await svc.finishUpload(await requireMember(), uploadUrl, sha256)
  if (r.nodeId) refresh()
  return r
}

export async function listVersions(nodeId: string): Promise<svc.Version[]> {
  return svc.listVersions(await requireMember(), nodeId)
}

// Points the file at this version, older or newer. Nothing is copied or lost,
// so switching back is the same call with the other version.
export async function makeCurrent(
  versionId: string
): Promise<{ error?: string }> {
  const r = await svc.makeCurrent(await requireMember(), versionId)
  if (!r.error) refresh()
  return r
}

export async function deleteVersion(
  versionId: string
): Promise<{ error?: string }> {
  const r = await svc.deleteVersion(await requireMember(), versionId)
  if (!r.error) refresh()
  return r
}

// Storage report: every older version of a file, except ones kept forever.
export async function deleteOlderVersions(
  nodeId: string
): Promise<{ error?: string; count?: number }> {
  const r = await svc.deleteOlderVersions(await requireMember(), nodeId)
  if (!r.error) refresh()
  return r
}

export async function setVersionNote(
  versionId: string,
  raw: string
): Promise<{ error?: string }> {
  return svc.setVersionNote(await requireMember(), versionId, raw)
}

export async function setVersionKeep(
  versionId: string,
  keep: boolean
): Promise<{ error?: string }> {
  return svc.setVersionKeep(await requireMember(), versionId, keep)
}

// Saves a version as its own file next to the original, named "report (v3).pdf".
// It shares the stored object, so it takes no extra space.
export async function copyVersion(
  versionId: string
): Promise<{ error?: string; name?: string }> {
  const r = await svc.copyVersion(await requireMember(), versionId)
  if (!r.error) refresh()
  return r
}

// For the in-browser zip fallback: presigned URLs for everything under `ids`.
export async function zipManifest(ids: string[]): Promise<svc.ZipManifest> {
  return svc.zipManifest(await requireMember(), ids)
}

// A short-lived direct S3 URL for the previewer.
// `open`: someone is looking at it (Recent), not just drawing its thumbnail.
export async function previewUrl(
  id: string,
  v?: string | null,
  open = false,
  quality: 480 | 720 | null = null
): Promise<string | null> {
  return svc.previewUrl(await requireMember(), id, v, open, quality)
}

// Collabora's viewer for an office file, or null to use the built-in viewers.
export async function officeFrame(
  id: string,
  v?: string | null
): Promise<{ action: string; token: string } | null> {
  return svc.officeFrame(await requireMember(), id, v)
}
