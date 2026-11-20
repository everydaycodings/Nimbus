import { SettingRow, SettingsForm, resettable } from "@/components/admin/setting"
import { CopyButton } from "@/components/copy-button"
import { Input } from "@/components/ui/input"
import { callbackUrl } from "@/lib/import/connections"
import type { Settings } from "@/lib/signup"
import { setImportTool } from "./actions"

const CHECK = "size-4 pointer-coarse:size-6 shrink-0 accent-primary self-start sm:self-end"

const APPS = [
  {
    key: "Google",
    id: "importGoogleClientId",
    secret: "importGoogleClientSecret",
    label: "Google Drive and Photos",
    guide: (
      <>
        In the Google Cloud console, make a project and turn on the <b>Google Drive API</b> and the <b>Photos Library API</b>. Under APIs &amp; Services,
        configure the consent screen and add the scopes <code>drive.readonly</code> and <code>photoslibrary.readonly</code>, then create an <b>OAuth client ID</b> of type
        Web application and add the redirect URL below. While the app is in Testing, only listed test users can connect and tokens last 7 days; publish it to avoid that.
        Google lets an app read only the photos it created through the Photos API, so Takeout is the way to move a whole photo library.
      </>
    ),
  },
  {
    key: "Dropbox",
    id: "importDropboxClientId",
    secret: "importDropboxClientSecret",
    label: "Dropbox",
    guide: (
      <>
        In the Dropbox App Console, create an app with <b>Scoped access</b> and <b>Full Dropbox</b>. On Permissions, turn on <code>files.metadata.read</code> and <code>files.content.read</code>.
        On Settings, add the redirect URL below and copy the app key and secret here.
      </>
    ),
  },
  {
    key: "Onedrive",
    id: "importOnedriveClientId",
    secret: "importOnedriveClientSecret",
    label: "OneDrive",
    guide: (
      <>
        In Microsoft Entra, register an app that accepts <b>personal Microsoft accounts</b> (and work accounts if you want those too), add a <b>Web</b> redirect with the URL below, and under API permissions
        add the delegated <code>Files.Read.All</code> and <code>offline_access</code>. Make a client secret and copy its <i>value</i> here with the application (client) ID.
      </>
    ),
  },
] as const

// Cloud Import's admin form: the switch, and an OAuth app per cloud service so members get a Connect button.
export function ImportSettings({ s }: { s: Settings }) {
  const reset = resettable(s)
  const callback = callbackUrl()
  return (
    <SettingsForm
      action={setImportTool}
      title="Cloud import"
      description="Members bring files over from Google Drive and Photos, Dropbox, OneDrive, S3, WebDAV, SFTP and Google Takeout. The worker runs rclone. Without an OAuth app, members can paste a token from “rclone authorize” instead."
    >
      <SettingRow
        id="import-enabled"
        label="Allow Cloud import"
        htmlFor="importToolEnabled"
        hint="Off hides it from everyone and pauses runs. Connections, imports and imported files are kept."
        tip={{ does: "Shows Cloud import under More and lets the worker run imports.", affects: "Everyone. Nothing is deleted while it is off.", default: "On" }}
        reset={reset("importToolEnabled")}
      >
        <input type="checkbox" id="importToolEnabled" name="importToolEnabled" defaultChecked={s.importToolEnabled} className={CHECK} />
      </SettingRow>
      <SettingRow id="import-callback" label="Redirect URL" hint="Register this exact address as the redirect (callback) URL in each OAuth app below." stacked>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-input/20 px-3 py-2 font-mono text-sm" title={callback}>{callback}</code>
          <CopyButton value={callback} label="Copy the redirect URL" />
        </div>
      </SettingRow>
      {APPS.map((a) => {
        const sealed = s[a.secret]
        return (
          <div key={a.key} className="contents">
            <SettingRow
              id={`import-${a.key.toLowerCase()}-id`}
              label={`${a.label} client ID`}
              htmlFor={a.id}
              hint={<span className="[&_code]:font-mono [&_code]:text-xs">{a.guide}</span>}
              reset={reset(a.id)}
            >
              <Input id={a.id} name={a.id} autoComplete="off" spellCheck={false} defaultValue={s[a.id] ?? ""} />
            </SettingRow>
            <SettingRow id={`import-${a.key.toLowerCase()}-secret`} label={`${a.label} client secret`} htmlFor={a.secret} hint="Leave blank to keep it." reset={reset(a.secret)}>
              <div className="grid gap-2">
                <Input id={a.secret} name={a.secret} type="password" autoComplete="new-password" placeholder={sealed ? "••••••••••••" : ""} />
                {sealed && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" name={`clear${a.key}`} className="size-4 accent-primary" />
                    Remove the stored secret
                  </label>
                )}
              </div>
            </SettingRow>
          </div>
        )
      })}
    </SettingsForm>
  )
}
