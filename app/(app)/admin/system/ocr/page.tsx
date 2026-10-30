import {
  AdminPage,
  SELECT,
  SettingRow,
  SettingsForm,
  resettable,
  sizeField,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import { setDerive, setOcrLangs } from "../../actions"

export const metadata = { title: "Text in images · Admin · Nimbus" }

export default async function OcrPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const max = sizeField(s.deriveMaxBytes, "MB", "GB")

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

      <SettingsForm
        action={setDerive}
        title="Background thumbnails & text"
        description="Files no browser handled, like WebDAV and API uploads, get their thumbnail and search text from the worker a couple of minutes later. Images, PDFs and text files; videos wait for a browser."
      >
        <SettingRow
          id="derive-jobs"
          label="Jobs at a time"
          htmlFor="deriveJobs"
          hint="Up to 8. More finishes a big upload sooner but takes more of the server's memory and CPU."
          tip={{
            does: "How many files the worker reads at once to make thumbnails and search text.",
            affects: "The worker, within a minute of saving.",
            default: "1",
            example: "2",
          }}
          reset={reset("deriveConcurrency")}
        >
          <Input
            id="deriveJobs"
            name="deriveJobs"
            type="number"
            min={1}
            max={8}
            step={1}
            defaultValue={s.deriveConcurrency}
          />
        </SettingRow>
        <SettingRow
          id="derive-max"
          label="Largest file to process"
          htmlFor="deriveMax"
          hint="Bigger files are skipped and get a thumbnail when someone opens them in a browser."
          tip={{
            does: "Caps the size of a file the worker reads whole into memory.",
            affects: "Files processed from now on.",
            default: "200 MB",
            example: "1 GB",
          }}
          reset={reset("deriveMaxBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              id="deriveMax"
              name="deriveMax"
              type="number"
              min={1}
              step="any"
              defaultValue={max.value}
            />
            <select
              aria-label="Unit"
              name="unit"
              defaultValue={max.unit}
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
