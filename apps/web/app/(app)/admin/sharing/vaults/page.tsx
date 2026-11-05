import { inArray } from "drizzle-orm"
import Link from "next/link"

import {
  AdminPage,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { UserAvatar } from "@/components/user-avatar"
import { Input } from "@/components/ui/input"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"
import { getSettings } from "@/lib/signup"
import { allVaults } from "@/lib/vault"
import { setVaultPolicy } from "../../actions"

export const metadata = { title: "Vaults · Admin · Nimbus" }

export default async function VaultsPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const vaults = await allVaults()

  const byOwner = new Map<
    string,
    { vaults: number; bytes: number; items: number }
  >()
  for (const v of vaults) {
    const o = byOwner.get(v.ownerId) ?? { vaults: 0, bytes: 0, items: 0 }
    byOwner.set(v.ownerId, {
      vaults: o.vaults + 1,
      bytes: o.bytes + v.bytes,
      items: o.items + v.items,
    })
  }
  const people = byOwner.size
    ? await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        })
        .from(user)
        .where(inArray(user.id, [...byOwner.keys()]))
    : []
  const owners = people
    .map((p) => ({ ...p, ...byOwner.get(p.id)! }))
    .sort((a, b) => b.bytes - a.bytes)
  const total = vaults.reduce((n, v) => n + v.bytes, 0)

  return (
    <AdminPage
      title="Vaults"
      description="Vaults are encrypted in the member's browser with a passphrase only they know. Nobody on this server can open or recover them."
    >
      <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card">
        {(
          [
            ["Vaults", vaults.length.toLocaleString("en")],
            ["Members using them", owners.length.toLocaleString("en")],
            ["Encrypted data", formatBytes(total)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <SettingsForm action={setVaultPolicy} title="Policy">
        <SettingRow
          id="allow-vaults"
          label="Allow new vaults"
          htmlFor="vaults-enabled"
          hint="Off: members can't make new vaults. The ones they have keep working."
          tip={{
            does: "Lets members create end-to-end encrypted vaults. Files in a vault get no previews or content search, and a lost passphrase means lost files.",
            affects: "New vaults. Existing ones are untouched.",
            default: "On",
          }}
          reset={reset("vaultsEnabled")}
        >
          <input
            type="checkbox"
            id="vaults-enabled"
            name="enabled"
            defaultChecked={s.vaultsEnabled}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="vaults-per-member"
          label="Vaults per member"
          htmlFor="maxVaults"
          hint="Blank for no limit."
          tip={{
            does: "The most vaults one member can have at a time.",
            affects: "Members making a new vault.",
            default: "No limit",
            example: "3",
          }}
          reset={reset("maxVaultsPerMember")}
        >
          <Input
            id="maxVaults"
            name="maxVaults"
            type="number"
            min={1}
            max={1000}
            step={1}
            defaultValue={s.maxVaultsPerMember ?? ""}
            placeholder="No limit"
          />
        </SettingRow>
      </SettingsForm>

      <section className="flex flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">Usage by member</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Sizes only. Delete a vault from the ⋯ menu on{" "}
            <Link
              href="/admin/members"
              className="text-foreground underline underline-offset-4"
            >
              Members
            </Link>
            .
          </p>
        </div>
        {owners.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No one has made a vault yet.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {owners.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                  <UserAvatar name={o.name} image={o.image} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{o.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {o.email}
                    </p>
                  </div>
                  <p className="text-right text-sm text-muted-foreground tabular-nums">
                    <span className="text-foreground">
                      {formatBytes(o.bytes)}
                    </span>
                    <span className="block text-xs">
                      {o.vaults} vault{o.vaults === 1 ? "" : "s"} · {o.items}{" "}
                      file
                      {o.items === 1 ? "" : "s"}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </section>
    </AdminPage>
  )
}
