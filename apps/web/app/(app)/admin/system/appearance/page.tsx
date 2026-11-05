import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { TOAST_POSITIONS, type ToastPosition } from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import { cn } from "@/lib/utils"
import { setToastPosition } from "../../actions"

export const metadata = { title: "Appearance · Admin · Nimbus" }

const TOAST_LABEL: Record<ToastPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
}

export default async function AppearancePage() {
  const s = await getSettings()
  const reset = resettable(s)

  return (
    <AdminPage
      title="Appearance"
      description="How Nimbus looks for everyone on this instance."
    >
      <SettingsForm action={setToastPosition}>
        <SettingRow
          id="toast-position"
          label="Action message position"
          hint="Where short messages like “Moved 3 items to the trash.” appear. The bottom-right corner is kept for uploads."
          tip={{
            does: "Moves the short confirmations that appear after an action, like moving or deleting files.",
            affects: "Everyone on this Nimbus.",
            default: "Bottom center",
          }}
          reset={reset("toastPosition")}
          stacked
        >
          <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <legend className="sr-only">Position</legend>
            {TOAST_POSITIONS.map((p) => {
              const [y, x] = p.split("-")
              return (
                <label
                  key={p}
                  className="flex cursor-pointer flex-col gap-2.5 rounded-lg border p-3 transition-colors hover:bg-input/20 has-checked:border-ring/60 has-checked:bg-input/30 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
                >
                  {/* A tiny screen with the toast where it would sit. */}
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-14 rounded-md border bg-background p-1.5",
                      y === "top" ? "items-start" : "items-end",
                      x === "left"
                        ? "justify-start"
                        : x === "right"
                          ? "justify-end"
                          : "justify-center"
                    )}
                  >
                    <span className="h-2 w-8 rounded-sm bg-muted-foreground/60" />
                  </span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="radio"
                      name="position"
                      value={p}
                      defaultChecked={p === s.toastPosition}
                      className="size-4 shrink-0 accent-primary outline-none"
                    />
                    {TOAST_LABEL[p]}
                  </span>
                </label>
              )
            })}
          </fieldset>
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
