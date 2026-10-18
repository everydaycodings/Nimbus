import { XIcon } from "@phosphor-icons/react/dist/ssr"

import {
  AdminPage,
  SELECT,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
  sizeField,
} from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import {
  addBlockedExtension,
  removeBlockedExtension,
  setUploadLimit,
} from "../../actions"

export const metadata = { title: "Uploads · Admin · Nimbus" }

export default async function UploadsPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const size = sizeField(s.maxUploadBytes, "MB", "GB")

  return (
    <AdminPage
      title="Uploads"
      description="Limits checked before any bytes move, so a refused file never takes up space."
    >
      <SettingsForm action={setUploadLimit}>
        <SettingRow
          id="largest-file"
          label="Largest file"
          htmlFor="maxSize"
          hint="Leave blank for no limit."
          tip={{
            does: "Refuses any single file bigger than this, before the upload starts.",
            affects: "Everyone, including uploads through public links.",
            default: "No limit",
            example: "2 GB",
          }}
          reset={reset("maxUploadBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              id="maxSize"
              name="maxSize"
              type="number"
              min={0.01}
              step="any"
              defaultValue={size.value}
              placeholder="No limit"
            />
            <select
              aria-label="Unit"
              name="unit"
              defaultValue={size.unit}
              className={SELECT}
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>

      <Section>
        <SettingRow
          id="blocked-types"
          label="Blocked file types"
          htmlFor="ext"
          hint="Files ending in these extensions can't be uploaded."
          tip={{
            does: "Refuses uploads by file extension. Files already stored stay where they are.",
            affects: "Everyone, including uploads through public links.",
            default: "None",
            example: "exe, bat, msi",
          }}
          stacked
        >
          <form action={addBlockedExtension} className="flex gap-2">
            <Input
              id="ext"
              name="ext"
              placeholder="exe"
              required
              pattern="\*?\.?[A-Za-z0-9_\-]{1,20}"
              title="An extension like exe or .exe"
              className="max-w-xs"
            />
            <SubmitButton variant="outline">Block type</SubmitButton>
          </form>
          {s.blockedExtensions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every file type can be uploaded.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {s.blockedExtensions.map((ext) => (
                <li
                  key={ext}
                  className="flex h-8 items-center gap-1 rounded-md border pr-1 pl-3 font-mono text-sm"
                >
                  .{ext}
                  <form action={removeBlockedExtension.bind(null, ext)}>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Unblock .${ext}`}
                    >
                      <XIcon />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </SettingRow>
      </Section>
    </AdminPage>
  )
}
