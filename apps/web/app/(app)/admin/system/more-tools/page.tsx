import Link from "next/link"

import { AdminPage, SettingRow, SettingsForm, resettable } from "@/components/admin/setting"
import { CopyButton } from "@/components/copy-button"
import { Input } from "@/components/ui/input"
import { appUrl } from "@/lib/email"
import { ImportSettings } from "./import-form"
import { ServerBackupSettings } from "./server-backup-form"
import { getSettings } from "@/lib/signup"
import { setArchiverTool, setCleanupTool, setConvertTool, setMoreTools, setRegistryTools } from "./actions"

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
      <SettingsForm action={setCleanupTool} title="Clean up" description="Members find duplicates, similar photos, big files and ones they never open.">
        <SettingRow
          id="cleanup-enabled"
          label="Allow Clean up"
          htmlFor="cleanupToolEnabled"
          hint="Off hides it from everyone. Nothing is deleted."
          tip={{
            does: "Shows Clean up under More. The worker keeps reading file hashes either way.",
            affects: "Everyone.",
            default: "On",
          }}
          reset={reset("cleanupToolEnabled")}
        >
          <input type="checkbox" id="cleanupToolEnabled" name="cleanupToolEnabled" defaultChecked={s.cleanupToolEnabled} className={CHECK} />
        </SettingRow>
      </SettingsForm>
      <SettingsForm action={setConvertTool} title="Media converter" description="Members convert, compress and trim video, audio and images. The worker runs ffmpeg, so heavy use takes CPU from everything else.">
        <SettingRow
          id="convert-enabled"
          label="Allow the media converter"
          htmlFor="convertToolEnabled"
          hint="Off hides it from everyone. Waiting conversions fail and watch folders pause."
          tip={{ does: "Shows the media converter under More and Convert… in the file menu.", affects: "Everyone. Converted files and presets are kept.", default: "On" }}
          reset={reset("convertToolEnabled")}
        >
          <input type="checkbox" id="convertToolEnabled" name="convertToolEnabled" defaultChecked={s.convertToolEnabled} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="convert-concurrency"
          label="Conversions at the same time"
          htmlFor="convertConcurrency"
          hint="1 to 8. Each one uses CPU until it finishes; the rest wait in line."
          tip={{ does: "How many files are converted together across all members.", affects: "The worker, within a minute.", default: "1" }}
          reset={reset("convertConcurrency")}
        >
          <Input id="convertConcurrency" name="convertConcurrency" type="number" min={1} max={8} step={1} defaultValue={s.convertConcurrency} />
        </SettingRow>
        <SettingRow
          id="convert-max-size"
          label="Largest file"
          htmlFor="convertMaxMb"
          hint="Megabytes. 0 means no limit."
          tip={{ does: "Refuses to convert a file bigger than this.", affects: "New conversions and watch folders.", default: "No limit" }}
          reset={reset("convertMaxBytes")}
        >
          <div className="flex items-center gap-2">
            <Input id="convertMaxMb" name="convertMaxMb" type="number" min={0} step={1} defaultValue={s.convertMaxBytes ? Math.round(s.convertMaxBytes / 1024 / 1024) : 0} />
            <span className="shrink-0 text-sm text-muted-foreground">MB</span>
          </div>
        </SettingRow>
        <SettingRow
          id="convert-max-length"
          label="Longest video or audio"
          htmlFor="convertMaxMinutes"
          hint="Minutes. 0 means no limit."
          tip={{ does: "Fails a conversion whose media is longer than this.", affects: "New conversions.", default: "No limit" }}
          reset={reset("convertMaxSeconds")}
        >
          <div className="flex items-center gap-2">
            <Input id="convertMaxMinutes" name="convertMaxMinutes" type="number" min={0} step={1} defaultValue={s.convertMaxSeconds ? Math.round(s.convertMaxSeconds / 60) : 0} />
            <span className="shrink-0 text-sm text-muted-foreground">minutes</span>
          </div>
        </SettingRow>
        <SettingRow
          id="convert-daily"
          label="Minutes per member per day"
          htmlFor="convertDailyMinutes"
          hint="Minutes of video and audio each member can convert a day. 0 means no limit. Images don't count."
          tip={{ does: "Stops a member from converting more media than this each day (server midnight).", affects: "New conversions.", default: "No limit" }}
          reset={reset("convertDailyMinutes")}
        >
          <Input id="convertDailyMinutes" name="convertDailyMinutes" type="number" min={0} step={1} defaultValue={s.convertDailyMinutes} />
        </SettingRow>
        <SettingRow
          id="convert-hwaccel"
          label="Hardware video encoding"
          htmlFor="convertHwaccel"
          hint="The server needs the device (/dev/dri for VAAPI, an NVIDIA runtime for NVENC). If it fails, conversion falls back to software."
          tip={{ does: "Encodes video on the graphics card instead of the CPU.", affects: "Video conversions, not GIFs, audio or images.", default: "Off" }}
          reset={reset("convertHwaccel")}
        >
          <select id="convertHwaccel" name="convertHwaccel" defaultValue={s.convertHwaccel} className="h-8 w-full rounded-lg border border-input bg-input/30 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <option value="off">Off (software)</option>
            <option value="vaapi">VAAPI (Intel, AMD)</option>
            <option value="nvenc">NVENC (NVIDIA)</option>
          </select>
        </SettingRow>
      </SettingsForm>
      <SettingsForm action={setRegistryTools} title="Registry tools" description="Members trim old tags and untagged images with rules, and mirror images from other registries. Needs the container registry.">
        <SettingRow
          id="registry-tools-enabled"
          label="Allow Registry tools"
          htmlFor="registryToolsEnabled"
          hint="Off hides it from everyone and pauses rules and mirrors. Nothing is deleted."
          tip={{
            does: "Shows Registry tools under More and lets the worker run cleanup rules and mirrors.",
            affects: "Everyone. Rules and mirrors are kept while it is off.",
            default: "On",
          }}
          reset={reset("registryToolsEnabled")}
        >
          <input type="checkbox" id="registryToolsEnabled" name="registryToolsEnabled" defaultChecked={s.registryToolsEnabled} className={CHECK} />
        </SettingRow>
      </SettingsForm>
      <SettingsForm action={setArchiverTool} title="Website archive" description="Members save web pages as HTML, PDF, a screenshot and text. Pages are opened in a separate browser service, so nothing runs inside Nimbus itself.">
        <SettingRow
          id="archiver-enabled"
          label="Allow the Website archive"
          htmlFor="archiverToolEnabled"
          hint="Off hides it from everyone and stops scheduled captures. Saved pages and files are kept."
          tip={{ does: "Shows Website archive under More and lets the worker capture pages.", affects: "Everyone. Saved pages and their files stay while it is off.", default: "On" }}
          reset={reset("archiverToolEnabled")}
        >
          <input type="checkbox" id="archiverToolEnabled" name="archiverToolEnabled" defaultChecked={s.archiverToolEnabled} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="archiver-browser"
          label="Browser service address"
          htmlFor="archiverBrowserUrl"
          hint="The Chromium container's websocket address, like ws://browser:3000?token=nimbus-browser (the BROWSER_TOKEN, if you set one). Start it with: docker compose --profile browser up -d browser. Blank uses ARCHIVER_BROWSER_URL from .env (setup.sh writes it); with neither, the tool says it needs the browser service."
          tip={{ does: "Where Nimbus connects to open pages (Chrome DevTools protocol, the browserless image).", affects: "Every capture. Members' links and cookies are sent to this browser.", default: "Blank (ARCHIVER_BROWSER_URL, else off)" }}
          reset={reset("archiverBrowserUrl")}
        >
          <Input id="archiverBrowserUrl" name="archiverBrowserUrl" type="text" pattern={"wss?://\\S+"} title="Starts with ws:// or wss://" autoComplete="off" spellCheck={false} placeholder="ws://browser:3000?token=…" defaultValue={s.archiverBrowserUrl ?? ""} />
        </SettingRow>
      </SettingsForm>
      <ImportSettings s={s} />
      <ServerBackupSettings s={s} />
    </AdminPage>
  )
}
