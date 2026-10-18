import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import { setOfficeUrl } from "../../actions"

export const metadata = { title: "Office documents · Admin · Nimbus" }

export default async function OfficePage() {
  const s = await getSettings()
  const reset = resettable(s)

  return (
    <AdminPage
      title="Office documents"
      description="Word, Excel, PowerPoint and OpenDocument files can open in a Collabora Online server you run, read-only."
    >
      <SettingsForm action={setOfficeUrl}>
        <SettingRow
          id="collabora-url"
          label="Collabora server"
          htmlFor="officeUrl"
          hint="Leave blank to use the built-in viewers."
          tip={{
            does: "Opens office files in Collabora Online instead of the built-in viewers. The address must be reachable from members' browsers.",
            affects:
              "Everyone previewing an office file, including through public links.",
            default: "Off (built-in viewers)",
            example: "https://office.example.com",
          }}
          reset={reset("officeUrl")}
        >
          <Input
            id="officeUrl"
            name="officeUrl"
            type="url"
            defaultValue={s.officeUrl ?? ""}
            placeholder="https://office.example.com"
          />
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
