import { sql } from "drizzle-orm"

import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { db } from "@/lib/db"
import { kmsConfigured } from "@/lib/secrets/kms"
import { getSettings } from "@/lib/signup"
import { setSecretsPolicy } from "../../actions"

export const metadata = { title: "Secrets · Admin · Nimbus" }

export default async function SecretsPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const [n] = await db.execute<{ projects: number; secrets: number }>(sql`
    select (select count(*)::int from secret_projects) as projects,
      (select count(*)::int from secrets where deleted_at is null) as secrets`)

  return (
    <AdminPage
      title="Secrets"
      description="Projects of environment keys and values, sealed on the server with SECRETS_ROOT_KEY. Members unlock the section with their password, a passkey, a two-factor code or a PIN. Admins never see values here."
    >
      <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card">
        {(
          [
            ["Projects", n.projects.toLocaleString("en")],
            ["Secrets", n.secrets.toLocaleString("en")],
            ["Root key", kmsConfigured() ? "Set" : "Missing"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {!kmsConfigured() && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-pretty">
          SECRETS_ROOT_KEY isn&apos;t set, so Secrets can&apos;t open. Generate one with{" "}
          <code className="font-mono">openssl rand -base64 32</code>, add it to the
          server&apos;s environment and restart. Keep a copy offline: without it every
          stored secret is unreadable.
        </p>
      )}

      <SettingsForm action={setSecretsPolicy} title="Policy">
        <SettingRow
          id="allow-secrets"
          label="Allow Secrets"
          htmlFor="secrets-enabled"
          hint="Off: Secrets disappears from the sidebar and its API stops answering. Nothing is deleted."
          tip={{
            does: "Shows the Secrets section, where members keep environment variables and other keys in projects.",
            affects: "Every member.",
            default: "On",
          }}
          reset={reset("secretsEnabled")}
        >
          <input
            type="checkbox"
            id="secrets-enabled"
            name="enabled"
            defaultChecked={s.secretsEnabled}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="secret-projects-per-member"
          label="Projects per member"
          htmlFor="maxProjects"
          hint="Blank for no limit. Counts projects a member created."
          tip={{
            does: "The most Secrets projects one member can create.",
            affects: "Members making a new project.",
            default: "No limit",
            example: "5",
          }}
          reset={reset("maxSecretProjectsPerMember")}
        >
          <Input
            id="maxProjects"
            name="maxProjects"
            type="number"
            min={1}
            max={1000}
            step={1}
            defaultValue={s.maxSecretProjectsPerMember ?? ""}
            placeholder="No limit"
          />
        </SettingRow>
        <SettingRow
          id="secrets-per-project"
          label="Secrets per project"
          htmlFor="maxSecrets"
          hint="Blank for no limit. Counts every environment and folder."
          tip={{
            does: "The most secrets one project can hold, trash not counted.",
            affects: "Adding or importing secrets.",
            default: "No limit",
            example: "500",
          }}
          reset={reset("maxSecretsPerProject")}
        >
          <Input
            id="maxSecrets"
            name="maxSecrets"
            type="number"
            min={1}
            max={100000}
            step={1}
            defaultValue={s.maxSecretsPerProject ?? ""}
            placeholder="No limit"
          />
        </SettingRow>
      </SettingsForm>
    </AdminPage>
  )
}
