import { count } from "drizzle-orm"

import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { db } from "@/lib/db"
import { appPasswords } from "@/lib/db/schema"
import { appUrl } from "@/lib/email"
import { getSettings } from "@/lib/signup"
import { setWebdav } from "../../actions"

export const metadata = { title: "WebDAV · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"

export default async function WebdavPage() {
  const [s, [{ n }]] = await Promise.all([
    getSettings(),
    db.select({ n: count() }).from(appPasswords),
  ])
  const reset = resettable(s)

  return (
    <AdminPage
      title="WebDAV"
      description={`Members mount their files as a drive at ${process.env.WEBDAV_URL ?? `${appUrl()}/dav`}, signing in with app passwords from Account. ${n === 1 ? "1 app password exists" : `${n} app passwords exist`}.`}
    >
      <SettingsForm action={setWebdav}>
        <SettingRow
          id="allow-webdav"
          label="Allow WebDAV"
          htmlFor="webdav"
          hint="Turn it off for one member from their page in Members."
          tip={{
            does: "Lets file managers and apps (GNOME Files, Dolphin, davfs2, rclone, Windows, macOS, phones) open Nimbus files with an app password.",
            affects:
              "Everyone. Off makes every app password stop working, without deleting them.",
            default: "On",
          }}
          reset={reset("webdav")}
        >
          <input
            type="checkbox"
            id="webdav"
            name="webdav"
            defaultChecked={s.webdav}
            className={CHECK}
          />
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
