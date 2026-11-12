import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { getSettings } from "@/lib/signup"
import { setMap } from "../../actions"

export const metadata = { title: "Photos map · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"

export default async function PhotosAdminPage() {
  const s = await getSettings()
  const reset = resettable(s)

  return (
    <AdminPage
      title="Photos map"
      description="The Places map shows each member's own photos that have a location. Locations stay on this server; only the map tiles come from outside."
    >
      <SettingsForm action={setMap}>
        <SettingRow
          id="map-enabled"
          label="Show the Places map"
          htmlFor="mapEnabled"
          hint="Off hides Places on the web and in the app. Photos keep their locations."
          tip={{
            does: "Turns the Places map in Photos on or off.",
            affects: "Everyone, within a minute for the app.",
            default: "On",
          }}
          reset={reset("mapEnabled")}
        >
          <input
            type="checkbox"
            id="mapEnabled"
            name="mapEnabled"
            defaultChecked={s.mapEnabled}
            className={CHECK}
          />
        </SettingRow>
        <SettingRow
          id="map-style"
          label="Map style URL"
          htmlFor="mapStyleUrl"
          hint="A MapLibre style. The default is OpenFreeMap, so browsers and phones fetch map tiles from tiles.openfreemap.org, a third party that sees those requests (not your photos or their locations). Use your own tile server to avoid that."
          tip={{
            does: "Where the map's style and tiles come from.",
            affects: "The map on the web and in the app.",
            default: "https://tiles.openfreemap.org/styles/liberty",
            example: "https://tiles.example.com/styles/basic/style.json",
          }}
          reset={reset("mapStyleUrl")}
        >
          <Input
            id="mapStyleUrl"
            name="mapStyleUrl"
            type="url"
            defaultValue={s.mapStyleUrl}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
