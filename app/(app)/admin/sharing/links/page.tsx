import {
  LinkSimpleIcon,
  LockSimpleIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { desc, eq, isNotNull, sql } from "drizzle-orm"

import {
  AdminPage,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { db } from "@/lib/db"
import { nodes, shares, user } from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import { revokeLink, setLinkPolicy } from "../../actions"

export const metadata = { title: "Public links · Admin · Nimbus" }

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" })
const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"

export default async function LinksPage() {
  const s = await getSettings()
  const reset = resettable(s)
  // Every public link on the instance, without a way in: admins see what's
  // shared and can revoke it, not open it.
  const links = await db
    .select({
      id: shares.id,
      name: shares.name,
      item: nodes.name,
      owner: user.name,
      ownerEmail: user.email,
      createdAt: shares.createdAt,
      expiresAt: shares.expiresAt,
      password: sql<boolean>`${shares.passwordHash} is not null`,
      upload: shares.allowUpload,
      views: shares.viewCount,
      downloads: shares.downloadCount,
    })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(isNotNull(shares.token))
    .orderBy(desc(shares.createdAt))
  const now = new Date()

  return (
    <AdminPage
      title="Public links"
      description="Links let anyone who has them open a file or folder without an account. Sharing with members isn't affected."
    >
      <SettingsForm
        action={setLinkPolicy}
        title="Policy"
        risks={[
          {
            name: "enabled",
            when: "unchecked",
            message: `Every public link stops opening right away${links.length ? `, including ${links.length} that exist now` : ""}. They work again if you turn links back on.`,
          },
        ]}
      >
        <SettingRow
          id="allow-links"
          label="Allow public links"
          htmlFor="enabled"
          hint="Off: no link opens, and members can't make new ones."
          tip={{
            does: "Turns public links on or off for the whole instance. Links aren't deleted when off, just paused.",
            affects: "Every public link and everyone who has one.",
            default: "On",
          }}
          reset={reset("publicLinksEnabled")}
        >
          <input
            type="checkbox"
            id="enabled"
            name="enabled"
            defaultChecked={s.publicLinksEnabled}
            className={CHECK}
          />
        </SettingRow>
        <SettingRow
          id="link-password"
          label="Require a password on new links"
          htmlFor="requirePassword"
          hint="Links made before this keep working as they are."
          tip={{
            does: "Members must set a password whenever they make a public link.",
            affects: "Links made from now on.",
            default: "Off",
          }}
          reset={reset("requireLinkPassword")}
        >
          <input
            type="checkbox"
            id="requirePassword"
            name="requirePassword"
            defaultChecked={s.requireLinkPassword}
            className={CHECK}
          />
        </SettingRow>
        <SettingRow
          id="link-expiry"
          label="Longest link lifetime"
          htmlFor="maxLinkDays"
          hint="In days. Blank lets links last forever."
          tip={{
            does: "New links must expire within this many days.",
            affects: "Links made from now on.",
            default: "No limit",
            example: "30",
          }}
          reset={reset("maxLinkDays")}
        >
          <Input
            id="maxLinkDays"
            name="maxLinkDays"
            type="number"
            min={1}
            max={3650}
            step={1}
            defaultValue={s.maxLinkDays ?? ""}
            placeholder="No limit"
          />
        </SettingRow>
      </SettingsForm>

      <section id="active-links" className="flex scroll-mt-24 flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            All links{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              {links.length}
            </span>
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {s.publicLinksEnabled
              ? "Revoking a link stops it for good. The file stays where it is."
              : "Public links are off, so none of these open right now."}
          </p>
        </div>
        {links.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No one has made a public link yet.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {links.map((l) => {
                const expired = l.expiresAt && l.expiresAt < now
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                      <LinkSimpleIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <span className="truncate">“{l.item}”</span>
                        <span className="shrink-0 font-normal text-muted-foreground">
                          · {l.name}
                        </span>
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {l.owner} ({l.ownerEmail})
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {l.password && (
                        <Badge variant="outline">
                          <LockSimpleIcon />
                          Password
                        </Badge>
                      )}
                      {l.upload && (
                        <Badge variant="outline">
                          <UploadSimpleIcon />
                          Uploads
                        </Badge>
                      )}
                      <span className="tabular-nums">
                        {l.views} views · {l.downloads} downloads
                      </span>
                      <span
                        className={expired ? "text-destructive" : undefined}
                      >
                        {l.expiresAt
                          ? `${expired ? "Expired" : "Expires"} ${date.format(l.expiresAt)}`
                          : "No expiry"}
                      </span>
                    </div>
                    <form action={revokeLink.bind(null, l.id)}>
                      <SubmitButton size="sm" variant="destructive">
                        Revoke
                      </SubmitButton>
                    </form>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}
      </section>
    </AdminPage>
  )
}
