// Git Backup runner contract. The UI (app/(app)/more/github-backup) calls only these; the runner
// builder implements them. Every function checks that `userId` owns the job/snapshot.
import "server-only"

export type Trigger = "schedule" | "manual" | "webhook" | "first"
export type RepoStage = "queued" | "checking" | "cloning" | "packing" | "uploading" | "done" | "skipped" | "failed"
export type Progress = { runId: string; startedAt: string; repos: { repoId: string; repo: string; stage: RepoStage; bytes?: number }[] } | null
export type TreeEntry = { path: string; type: "blob" | "tree"; size: number | null }

const todo = (): never => {
  throw new Error("not implemented")
}

// Queue a run now (whole job, or one repo). force: snapshot even if refs are unchanged.
export async function requestRun(userId: string, jobId: string, o: { trigger: Trigger; force?: boolean; repoId?: string }): Promise<{ runId: string }> {
  return todo()
}
// Live progress of the job's running run, null when idle.
export async function progress(userId: string, jobId: string): Promise<Progress> {
  return todo()
}
// Short-lived download URL for a snapshot's .tar.gz.
export async function snapshotDownloadUrl(userId: string, snapshotId: string): Promise<string> {
  return todo()
}
// Shell commands that download and restore the snapshot (curl + tar + git clone).
export async function restoreCommand(userId: string, snapshotId: string): Promise<string> {
  return todo()
}
// Push every ref of the snapshot to an empty remote. token: optional HTTPS token for that remote.
export async function pushSnapshot(userId: string, snapshotId: string, remoteUrl: string, token?: string): Promise<void> {
  return todo()
}
// Browse a snapshot at a ref (default: its default branch).
export async function snapshotTree(userId: string, snapshotId: string, o: { ref?: string; path?: string }): Promise<{ refs: string[]; ref: string; entries: TreeEntry[] }> {
  return todo()
}
export async function snapshotFile(userId: string, snapshotId: string, o: { ref?: string; path: string }): Promise<{ size: number; binary: boolean; text: string | null }> {
  return todo()
}
// Delete a job's stored archives too (used when the user deletes a job and ticks "delete backups").
export async function purgeJobArchives(userId: string, jobId: string): Promise<void> {
  return todo()
}
