import {
  AdminPage,
  SettingRow,
  SELECT,
  SettingsForm,
  resettable,
  sizeField,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import { setOfficeUrl, setPdfEditLimit } from "../../actions"

export const metadata = { title: "Office documents · Admin · Nimbus" }

export default async function OfficePage() {
  const s = await getSettings()
  const reset = resettable(s)
  const pdf = sizeField(s.maxPdfEditBytes, "MB", "GB")

  return (
    <AdminPage
      title="Office documents"
      description="Word, Excel, PowerPoint and OpenDocument files can open in a Collabora Online server you run, read-only. PDF editing limits are here too."
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

      <SettingsForm action={setPdfEditLimit}>
        <SettingRow
          id="largest-pdf-to-edit"
          label="Largest PDF to edit"
          htmlFor="pdfMax"
          hint="Bigger PDFs can still be viewed; their Edit button is hidden."
          tip={{
            does: "Hides the PDF editor's Edit button on files bigger than this, because the browser holds the whole file in memory while editing.",
            affects: "Members and the Android app, wherever they can edit a PDF.",
            default: "100 MB",
            example: "250 MB",
          }}
          reset={reset("maxPdfEditBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              id="pdfMax"
              name="pdfMax"
              type="number"
              min={1}
              step="any"
              required
              defaultValue={pdf.value}
            />
            <select
              aria-label="Unit"
              name="unit"
              defaultValue={pdf.unit}
              className={SELECT}
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
