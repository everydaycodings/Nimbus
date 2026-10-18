import Link from "next/link"

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
import { setDefaultQuota } from "../../actions"

export const metadata = { title: "Quotas · Admin · Nimbus" }

export default async function QuotasPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const quota = sizeField(s.defaultQuotaBytes, "GB", "TB")

  return (
    <AdminPage
      title="Quotas"
      description="How much each member can store, counting older versions and the trash."
    >
      <SettingsForm action={setDefaultQuota}>
        <SettingRow
          id="storage-per-member"
          label="Storage per member"
          htmlFor="quota"
          hint={
            <>
              Leave blank for no limit. Give someone a different amount from the
              ⋯ menu on{" "}
              <Link
                href="/admin/members"
                className="text-foreground underline underline-offset-4"
              >
                Members
              </Link>
              .
            </>
          }
          tip={{
            does: "Caps the space each member's files, older versions and trash can take. Uploads that would go over are refused.",
            affects:
              "Every member without their own amount. The owner is never limited.",
            default: "No limit",
            example: "50 GB",
          }}
          reset={reset("defaultQuotaBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              id="quota"
              name="quota"
              type="number"
              min={0.01}
              step="any"
              defaultValue={quota.value}
              placeholder="No limit"
            />
            <select
              aria-label="Unit"
              name="unit"
              defaultValue={quota.unit}
              className={SELECT}
            >
              <option value="GB">GB</option>
              <option value="TB">TB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
