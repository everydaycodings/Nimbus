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
          id="allow-secret-tokens"
          label="Allow machine tokens"
          htmlFor="secret-tokens"
          hint="Off: nms_ tokens stop working and no new ones can be made. Existing tokens are kept."
          tip={{
            does: "Lets project admins make read-only or read-write tokens for servers and CI.",
            affects: "Scripts using a token.",
            default: "On",
          }}
          reset={reset("secretTokensEnabled")}
        >
          <input
            type="checkbox"
            id="secret-tokens"
            name="tokens"
            defaultChecked={s.secretTokensEnabled}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="allow-secret-cli"
          label="Allow the command line"
          htmlFor="secret-cli"
          hint="Off: nimbus login, signed-in CLIs and the downloads stop working."
          tip={{
            does: "Lets members sign in the nimbus command line and download it from Secrets.",
            affects: "Everyone using the CLI.",
            default: "On",
          }}
          reset={reset("secretCliEnabled")}
        >
          <input
            type="checkbox"
            id="secret-cli"
            name="cli"
            defaultChecked={s.secretCliEnabled}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="allow-secret-shares"
          label="Allow one-time share links"
          htmlFor="secret-shares"
          hint="Off: new links can't be made and existing ones stop opening."
          tip={{
            does: "Lets members send a text or a secret as a link that opens once, for people without accounts.",
            affects: "Members sharing, and anyone holding a link.",
            default: "On",
          }}
          reset={reset("secretSharesEnabled")}
        >
          <input
            type="checkbox"
            id="secret-shares"
            name="shares"
            defaultChecked={s.secretSharesEnabled}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="secrets-leak-scan"
          label="Scan uploaded files for leaked secrets"
          htmlFor="secret-leak-scan"
          hint="On: the worker reads new text and code files (up to 1 MB, never vault files) for keys, tokens and private keys, and tells the owner. Only a masked preview is kept."
          tip={{
            does: "Looks for AWS, GitHub, Stripe and Slack keys, private keys, JWTs and high-entropy passwords in files members upload.",
            affects: "Members' uploads, and the worker's load.",
            default: "On",
          }}
          reset={reset("secretLeakScan")}
        >
          <input
            type="checkbox"
            id="secret-leak-scan"
            name="leakScan"
            defaultChecked={s.secretLeakScan}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="secrets-hibp"
          label="Check passwords against Have I Been Pwned"
          htmlFor="secret-hibp"
          hint="On: when a member sets a password in Secrets, their browser asks this server for the first five characters of its SHA-1 hash, and the server asks api.pwnedpasswords.com. The password never leaves the browser."
          tip={{
            does: "Warns when a Login item's password, or a secret named like a password, is in a known data breach.",
            affects: "This server's outgoing connections to api.pwnedpasswords.com.",
            default: "On",
          }}
          reset={reset("secretHibp")}
        >
          <input
            type="checkbox"
            id="secret-hibp"
            name="hibp"
            defaultChecked={s.secretHibp}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="secrets-allow-private"
          label="Allow private addresses in domain watch and webhooks"
          htmlFor="secret-allow-private"
          hint="Off: domain watch and webhooks only reach public hosts. On: they may also connect to loopback, private-network and link-local addresses."
          tip={{
            does: "Lets project admins watch certificates on internal hosts and send webhooks to internal services. The cloud metadata address (169.254.169.254) is only reachable with this on. Database connections, server push and the SSH terminal may reach private addresses unless the server sets SECRETS_BLOCK_PRIVATE=1; they never reach Nimbus's own database or Redis.",
            affects: "This server's outgoing connections from domain watch and webhooks.",
            default: "Off",
          }}
          reset={reset("secretAllowPrivate")}
        >
          <input
            type="checkbox"
            id="secret-allow-private"
            name="allowPrivate"
            defaultChecked={s.secretAllowPrivate}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="secrets-require-2fa"
          label="Require two-factor for Secrets"
          htmlFor="secret-2fa"
          hint="On: members without two-factor sign-in can't open Secrets until they turn it on."
          tip={{
            does: "Keeps Secrets closed to accounts that sign in with a password alone.",
            affects: "Members without two-factor.",
            default: "Off",
          }}
          reset={reset("secretRequire2fa")}
        >
          <input
            type="checkbox"
            id="secret-2fa"
            name="require2fa"
            defaultChecked={s.secretRequire2fa}
            className="size-4 shrink-0 self-start accent-primary sm:self-end"
          />
        </SettingRow>
        <SettingRow
          id="secrets-max-idle"
          label="Longest idle time before auto-lock"
          htmlFor="maxIdle"
          hint="Minutes. Members can pick a shorter lock, never a longer one. Blank leaves it to them."
          tip={{
            does: "Caps how long Secrets stay unlocked with no activity.",
            affects: "Everyone using Secrets.",
            default: "No cap (members pick 5, 15, 30 or 60)",
            example: "15",
          }}
          reset={reset("secretMaxIdleMinutes")}
        >
          <Input id="maxIdle" name="maxIdle" type="number" min={1} max={1440} step={1} defaultValue={s.secretMaxIdleMinutes ?? ""} placeholder="No cap" />
        </SettingRow>
        <SettingRow
          id="secrets-unlock-hours"
          label="Ask for a fresh unlock after"
          htmlFor="unlockHours"
          hint="Hours. However active, an unlock ends this long after it was opened. Blank is 12 hours."
          tip={{
            does: "Forces everyone to prove themselves again, even while they keep working.",
            affects: "Everyone using Secrets.",
            default: "12 hours",
            example: "4",
          }}
          reset={reset("secretUnlockMaxHours")}
        >
          <Input id="unlockHours" name="unlockHours" type="number" min={1} max={720} step={1} defaultValue={s.secretUnlockMaxHours ?? ""} placeholder="12" />
        </SettingRow>
        <SettingRow
          id="secrets-trash-days"
          label="Empty a project's trash after"
          htmlFor="trashDays"
          hint="Days. Deleted secrets older than this are removed for good, history included. Blank keeps them until someone empties the trash."
          tip={{
            does: "Purges trashed secrets (hourly, by the worker).",
            affects: "Deleted secrets in every project.",
            default: "Never",
            example: "30",
          }}
          reset={reset("secretTrashDays")}
        >
          <Input id="trashDays" name="trashDays" type="number" min={1} max={3650} step={1} defaultValue={s.secretTrashDays ?? ""} placeholder="Never" />
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
