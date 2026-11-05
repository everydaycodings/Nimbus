import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import { setVersionRetention } from "../../actions"

export const metadata = { title: "Versions · Admin · Nimbus" }

const LOST =
  "Older versions past the new limit are deleted for good the next time cleanup runs. They can't be restored."

export default async function VersionsPage() {
  const s = await getSettings()
  const reset = resettable(s)

  return (
    <AdminPage
      title="Versions"
      description="Uploading a file with the same name keeps the old one as a version. The current version is never removed."
    >
      <SettingsForm
        action={setVersionRetention}
        risks={[
          { name: "keepLast", when: "fewer", message: LOST },
          { name: "maxAgeDays", when: "fewer", message: LOST },
        ]}
      >
        <SettingRow
          id="keep-newest"
          label="Versions to keep"
          htmlFor="keepLast"
          hint="Blank keeps every version."
          tip={{
            does: "Keeps only this many older versions of each file and deletes the rest, oldest first.",
            affects:
              "Every file on the instance. Older versions count toward quotas.",
            default: "All versions",
            example: "10",
          }}
          reset={reset("versionKeepLast")}
        >
          <Input
            id="keepLast"
            name="keepLast"
            type="number"
            min={1}
            step={1}
            defaultValue={s.versionKeepLast ?? ""}
            placeholder="All versions"
          />
        </SettingRow>
        <SettingRow
          id="version-age"
          label="Delete versions older than"
          htmlFor="maxAgeDays"
          hint="In days. Blank never deletes by age."
          tip={{
            does: "Deletes older versions once they reach this age.",
            affects: "Every file on the instance.",
            default: "Never",
            example: "90",
          }}
          reset={reset("versionMaxAgeDays")}
        >
          <Input
            id="maxAgeDays"
            name="maxAgeDays"
            type="number"
            min={1}
            step={1}
            defaultValue={s.versionMaxAgeDays ?? ""}
            placeholder="Never"
          />
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
