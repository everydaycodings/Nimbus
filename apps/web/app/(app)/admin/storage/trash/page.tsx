import {
  AdminPage,
  SELECT,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { getSettings } from "@/lib/signup"
import { setTrashRetention } from "../../actions"

export const metadata = { title: "Trash · Admin · Nimbus" }

export default async function TrashPage() {
  const s = await getSettings()
  const reset = resettable(s)

  return (
    <AdminPage
      title="Trash"
      description="Members can always restore, delete forever or empty the trash themselves."
    >
      <SettingsForm
        action={setTrashRetention}
        risks={[
          {
            name: "retention",
            when: "fewer",
            message:
              "Items already in everyone's trash longer than this are deleted for good the next time cleanup runs.",
          },
        ]}
      >
        <SettingRow
          id="trash-retention"
          label="Empty trash automatically"
          htmlFor="retention"
          hint="Trashed items older than this are deleted for good."
          tip={{
            does: "Deletes trashed files and folders for good once they've been in the trash this long, freeing their space.",
            affects: "Everyone's trash.",
            default: "Never, keep them until emptied",
            example: "After 30 days",
          }}
          reset={reset("trashRetentionDays")}
        >
          <select
            id="retention"
            name="retention"
            defaultValue={String(s.trashRetentionDays ?? 0)}
            className={SELECT}
          >
            <option value="0">Never</option>
            <option value="7">After 7 days</option>
            <option value="30">After 30 days</option>
            <option value="90">After 90 days</option>
          </select>
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
