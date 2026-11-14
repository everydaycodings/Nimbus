import { SubmitButton } from "@/components/submit-button"
import { FRAME } from "@/components/admin/setting"
import { ago } from "@/lib/health-rules"
import { rootKeyStatus } from "@/lib/secrets/root-rotate"
import { cn } from "@/lib/utils"
import { startRootRotation } from "./actions"
import { NewKey, Poll } from "./root-key-tools"

const days = (iso: string, now: number) => {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  return d < 1 ? "less than a day" : `${d} day${d === 1 ? "" : "s"}`
}

// Secrets root key: set or not, its fingerprint and age, and the rotate flow.
export async function RootKeyCard() {
  const st = await rootKeyStatus()
  const code = "rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
  return (
    <section aria-labelledby="rootkey-title" className={cn(FRAME, "flex max-w-3xl flex-col gap-4 px-5 py-4")}>
      <Poll on={st.configured && st.running} />
      <div className="grid gap-0.5">
        <h2 id="rootkey-title" className="text-sm font-semibold">
          Secrets root key
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">
          <code className={code}>SECRETS_ROOT_KEY</code> seals every Secrets project key and share link. Without it nothing in Secrets can be read.
        </p>
      </div>
      {!st.configured ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-pretty">
          Not set, or not 32 bytes. Secrets is closed until it is.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="font-medium">Set</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">Fingerprint</dt>
              <dd className="font-mono break-all">{st.fingerprint}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">In use for</dt>
              <dd>{days(st.since, st.now)}</dd>
            </div>
          </dl>

          {st.previous ? (
            <div className="grid gap-3 rounded-lg border bg-muted/20 px-4 py-3">
              <p className="text-sm font-medium">Rotation under way</p>
              <p className="text-sm text-pretty text-muted-foreground">
                <code className={code}>SECRETS_ROOT_KEY_PREVIOUS</code> ({st.previous}) is set, so everything still opens. {st.pending} value{st.pending === 1 ? " is" : "s are"} still sealed with it.
              </p>
              {st.running && (
                <div className="grid gap-1" role="status">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${st.total ? Math.round((st.done / st.total) * 100) : 0}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Re-wrapping: {st.done} of {st.total}
                  </p>
                </div>
              )}
              {st.error && <p className="text-sm text-destructive">Last run stopped: {st.error}. Run it again to carry on where it left off.</p>}
              {!st.running && st.pending === 0 && (
                <p className="text-sm text-pretty text-success">
                  Everything is sealed with the new key{st.finishedAt ? ` (finished ${ago(st.finishedAt, st.now)})` : ""}. Remove <code className={code}>SECRETS_ROOT_KEY_PREVIOUS</code> and restart.
                </p>
              )}
              {!st.running && st.pending > 0 && (
                <form action={startRootRotation} className="flex items-center gap-3">
                  <SubmitButton>{st.error || st.done ? "Resume re-wrapping" : "Re-wrap with the new key"}</SubmitButton>
                  <span className="text-xs text-muted-foreground">The worker does it; values themselves aren&apos;t touched.</span>
                </form>
              )}
            </div>
          ) : (
            <details className="group rounded-lg border px-4 py-3">
              <summary className="cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Rotate the root key</summary>
              <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm text-pretty text-muted-foreground">
                <li>Make a new key and keep a copy offline.</li>
                <li>
                  In the server&apos;s environment set <code className={code}>SECRETS_ROOT_KEY_PREVIOUS</code> to the current key and <code className={code}>SECRETS_ROOT_KEY</code> to the new one. Restart the app and the worker.
                </li>
                <li>Come back here and press Re-wrap. The worker seals each project key and share link under the new key, and shows progress.</li>
                <li>When it finishes, remove <code className={code}>SECRETS_ROOT_KEY_PREVIOUS</code> and restart.</li>
              </ol>
              <div className="mt-4">
                <NewKey />
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}
