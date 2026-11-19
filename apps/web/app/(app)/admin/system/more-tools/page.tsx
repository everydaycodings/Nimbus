import Link from "next/link"

import { AdminPage, SettingRow, SettingsForm, resettable } from "@/components/admin/setting"
import { CopyButton } from "@/components/copy-button"
import { Input } from "@/components/ui/input"
import { appUrl } from "@/lib/email"
import { getSettings } from "@/lib/signup"
import { setMoreTools } from "./actions"

export const metadata = { title: "More tools · Admin · Nimbus" }

const CHECK = "size-4 pointer-coarse:size-6 shrink-0 accent-primary self-start sm:self-end"

export default async function MoreToolsAdminPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const callback = appUrl("/api/gitbackup/oauth/callback")
  return (
    <AdminPage title="More tools" description="Extra tools members find under More in the sidebar.">
      <SettingsForm
        action={setMoreTools}
        title="Git Backup"
        description="Members back up their GitHub repos to S3 on a schedule."
        note={
          <Link
            href="/admin/system/more-tools/jobs"
            className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            See every member&apos;s backup jobs
          </Link>
        }
      >
        <SettingRow
          id="git-backup-enabled"
          label="Allow Git Backup"
          htmlFor="gitBackupEnabled"
          hint="Off hides it from everyone and pauses runs. Jobs and snapshots are kept."
          tip={{
            does: "Shows Git Backup under More and lets the worker run backup jobs.",
            affects: "Everyone. Existing jobs and backups stay while it is off.",
            default: "On",
          }}
          reset={reset("gitBackupEnabled")}
        >
          <input type="checkbox" id="gitBackupEnabled" name="gitBackupEnabled" defaultChecked={s.gitBackupEnabled} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="git-backup-interval"
          label="Shortest time between backups"
          htmlFor="gitBackupMinInterval"
          hint="Minutes, at least 5. Members can't schedule a job more often than this."
          tip={{
            does: "Sets the lowest interval a member can choose for a job or a single repo.",
            affects: "New and edited schedules. Jobs already faster than this run at this speed.",
            default: "15 minutes",
          }}
          reset={reset("gitBackupMinInterval")}
        >
          <div className="flex items-center gap-2">
            <Input id="gitBackupMinInterval" name="gitBackupMinInterval" type="number" min={5} step={1} defaultValue={s.gitBackupMinInterval} />
            <span className="shrink-0 text-sm text-muted-foreground">minutes</span>
          </div>
        </SettingRow>
        <SettingRow
          id="git-backup-concurrency"
          label="Runs at the same time"
          htmlFor="gitBackupConcurrency"
          hint="1 to 10. Each run clones repos, so more at once uses more disk and memory."
          tip={{
            does: "How many backup runs go together across all members. The rest wait in line.",
            affects: "The worker, from the next run.",
            default: "2",
          }}
          reset={reset("gitBackupConcurrency")}
        >
          <Input id="gitBackupConcurrency" name="gitBackupConcurrency" type="number" min={1} max={10} step={1} defaultValue={s.gitBackupConcurrency} />
        </SettingRow>
        <SettingRow
          id="git-backup-oauth-id"
          label="GitHub OAuth client ID"
          htmlFor="githubOauthClientId"
          hint="Optional. Lets members connect GitHub with a button instead of a token."
          reset={reset("githubOauthClientId")}
        >
          <Input id="githubOauthClientId" name="githubOauthClientId" autoComplete="off" defaultValue={s.githubOauthClientId ?? ""} />
        </SettingRow>
        <SettingRow
          id="git-backup-oauth-callback"
          label="OAuth callback URL"
          hint="Register this in your GitHub OAuth app."
          stacked
        >
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-input/20 px-3 py-2 font-mono text-sm" title={callback}>
              {callback}
            </code>
            <CopyButton value={callback} label="Copy the callback URL" />
          </div>
        </SettingRow>
        <SettingRow
          id="git-backup-oauth-secret"
          label="GitHub OAuth client secret"
          htmlFor="githubOauthClientSecret"
          hint="Leave blank to keep it."
          reset={reset("githubOauthClientSecret")}
        >
          <div className="grid gap-2">
            <Input
              id="githubOauthClientSecret"
              name="githubOauthClientSecret"
              type="password"
              autoComplete="new-password"
              placeholder={s.githubOauthClientSecret ? "••••••••••••" : ""}
            />
            {s.githubOauthClientSecret && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" name="clearSecret" className="size-4 accent-primary" />
                Remove the stored secret
              </label>
            )}
          </div>
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
