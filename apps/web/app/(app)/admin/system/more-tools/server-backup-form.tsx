import { SettingRow, SettingsForm, resettable } from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import type { Settings } from "@/lib/signup"
import { setServerBackupTool } from "./actions"

const CHECK = "size-4 pointer-coarse:size-6 shrink-0 accent-primary self-start sm:self-end"

export function ServerBackupSettings({ s }: { s: Settings }) {
  const reset = resettable(s)
  return (
    <SettingsForm action={setServerBackupTool} title="Server backup" description="Members back up folders and Docker volumes from their servers over SSH into an encrypted restic repository in S3. The worker image needs restic and ssh, and Nimbus logs in with a key it makes per server.">
      <SettingRow
        id="server-backup-enabled"
        label="Allow Server backup"
        htmlFor="serverBackupEnabled"
        hint="Off hides it from everyone and stops runs. Jobs, servers and stored backups are kept."
        tip={{ does: "Shows Server backup under More and lets the worker run backups.", affects: "Everyone. Nothing is deleted while it is off.", default: "On" }}
        reset={reset("serverBackupEnabled")}
      >
        <input type="checkbox" id="serverBackupEnabled" name="serverBackupEnabled" defaultChecked={s.serverBackupEnabled} className={CHECK} />
      </SettingRow>
      <SettingRow
        id="server-backup-members"
        label="Members can use it"
        htmlFor="serverBackupMembers"
        hint="Off limits it to admins. Members' scheduled backups pause and the page shows not found."
        tip={{ does: "Lets members add servers they have SSH access to. Nimbus connects out to whatever host they type.", affects: "Members. Admins always can.", default: "On" }}
        reset={reset("serverBackupMembers")}
      >
        <input type="checkbox" id="serverBackupMembers" name="serverBackupMembers" defaultChecked={s.serverBackupMembers} className={CHECK} />
      </SettingRow>
      <SettingRow
        id="server-backup-min-interval"
        label="Shortest time between backups"
        htmlFor="serverBackupMinInterval"
        hint="Minutes. A job can't be set to run more often."
        tip={{ does: "Stops a job from being scheduled more often than this.", affects: "New and edited jobs.", default: "60" }}
        reset={reset("serverBackupMinInterval")}
      >
        <Input id="serverBackupMinInterval" name="serverBackupMinInterval" type="number" min={5} step={1} defaultValue={s.serverBackupMinInterval} />
      </SettingRow>
    </SettingsForm>
  )
}
