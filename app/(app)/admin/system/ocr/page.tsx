import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import { setOcrLangs } from "../../actions"

export const metadata = { title: "Text in images · Admin · Nimbus" }

export default async function OcrPage() {
  const s = await getSettings()
  const reset = resettable(s)

  return (
    <AdminPage
      title="Text in images"
      description="Search reads the words in photos and screenshots up to 20 MB, in the browser of whoever uploads or opens them."
    >
      <SettingsForm action={setOcrLangs}>
        <SettingRow
          id="ocr-languages"
          label="Languages"
          htmlFor="ocrLangs"
          hint="Tesseract codes, separated by commas. Up to 5. Each extra language makes reading slower."
          tip={{
            does: "Tells text recognition which languages to expect, so search can find words inside images.",
            affects:
              "Images read from now on. Ones already read keep their text.",
            default: "eng",
            example: "eng, deu, fra, chi_sim",
          }}
          reset={reset("ocrLangs")}
        >
          <Input
            id="ocrLangs"
            name="ocrLangs"
            defaultValue={s.ocrLangs.split("+").join(", ")}
            placeholder="eng"
            autoComplete="off"
            spellCheck={false}
          />
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
