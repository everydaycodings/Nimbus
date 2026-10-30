import Link from "next/link"

import {
  AdminPage,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { appUrl } from "@/lib/email"
import { OIDC_ID, getOidcConfig, oidcReady, type OidcConfig } from "@/lib/oidc"
import { POLICY_MAX, POLICY_MIN } from "@/lib/password-policy"
import { hasPassword, requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { MAX_SESSIONS } from "@/lib/accounts"
import {
  setMultiAccount,
  setPasswordPolicy,
  setRequire2fa,
  setSavedLogins,
} from "../actions"
import { OidcForm, TestOidc } from "./oidc-form"

export const metadata = { title: "Authentication · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary"

function OidcEnv({ c }: { c: OidcConfig }) {
  const rows: [string, string][] = [
    ["OIDC_NAME", c.name],
    ["OIDC_ISSUER", c.issuer],
    ["OIDC_CLIENT_ID", c.clientId || "Not set"],
    ["OIDC_CLIENT_SECRET", c.clientSecret ? "Set" : "Not set"],
    ["OIDC_ONLY", c.only ? "true" : "false"],
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[minmax(0,12rem)_1fr] gap-4 px-4 py-2.5"
          >
            <dt className="truncate font-mono text-xs leading-5 text-muted-foreground">
              {k}
            </dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        To change these, edit the server&apos;s environment and restart Nimbus.
        Unset <code className="font-mono text-xs">OIDC_ISSUER</code> to manage
        OIDC here instead.
      </p>
      <TestOidc />
    </div>
  )
}

export default async function AuthenticationPage() {
  const me = await requireAdmin()
  // Mirrors setRequire2fa: you can't require what you don't use yourself.
  const needsOwn2fa = !me.twoFactorEnabled && (await hasPassword(me.id))
  const s = await getSettings()
  const reset = resettable(s)
  const blocked = needsOwn2fa && !s.require2fa
  const oidc = await getOidcConfig()
  const callback = appUrl(`/api/auth/callback/${OIDC_ID}`)

  return (
    <AdminPage
      title="Authentication"
      description="How people prove who they are when they sign in."
    >
      <SettingsForm
        action={setRequire2fa}
        title="Two-factor"
        description="A code from an authenticator app after the password. It works without email."
        disabled={blocked}
        note={
          blocked && (
            <>
              Turn on two-factor for{" "}
              <Link
                href="/account"
                className="text-foreground underline underline-offset-4"
              >
                your own account
              </Link>{" "}
              first.
            </>
          )
        }
        risks={[
          {
            name: "require2fa",
            when: "checked",
            message:
              "Everyone with a password and no two-factor, admins included, is stopped the next time they open Nimbus until they set it up.",
          },
        ]}
      >
        <SettingRow
          id="require-2fa"
          label="Require two-factor"
          htmlFor="require2fa"
          hint="Password accounts must set it up before they can use Nimbus. Nobody can turn it off while this is on."
          tip={{
            does: "Adds a one-time code from an authenticator app to every password sign-in.",
            affects:
              "All members and admins who sign in with a password. Google and GitHub sign-ins use the provider's own two-factor.",
            default: "Off",
          }}
          reset={reset("require2fa")}
        >
          <input
            type="checkbox"
            id="require2fa"
            name="require2fa"
            defaultChecked={s.require2fa}
            disabled={blocked}
            className={`${CHECK} self-start sm:self-end`}
          />
        </SettingRow>
      </SettingsForm>

      <SettingsForm
        action={setMultiAccount}
        title="Several accounts"
        description="People can sign in to more than one account in the same browser and switch between them from the account menu."
      >
        <SettingRow
          id="multi-account"
          label="Allow several accounts per browser"
          htmlFor="multiAccount"
          hint="Off hides “Add an existing account”. Accounts already signed in stay until they sign out."
          tip={{
            does: "Lets someone stay signed in to a personal and a work account at once.",
            affects:
              "Everyone on this Nimbus. Each account still needs its own password and two-factor.",
            default: "On",
          }}
          reset={reset("multiAccount")}
        >
          <input
            type="checkbox"
            id="multiAccount"
            name="multiAccount"
            defaultChecked={s.multiAccount}
            className={`${CHECK} self-start sm:self-end`}
          />
        </SettingRow>
        <SettingRow
          id="max-accounts"
          label="Accounts per browser"
          htmlFor="maxAccounts"
          hint={`From 2 to ${MAX_SESSIONS}.`}
          tip={{
            does: "The most accounts one browser can be signed in to at the same time.",
            affects: "Adding another account; ones already signed in are kept.",
            default: "5",
          }}
          reset={reset("maxAccounts")}
        >
          <Input
            id="maxAccounts"
            name="maxAccounts"
            type="number"
            min={2}
            max={MAX_SESSIONS}
            step={1}
            defaultValue={s.maxAccounts}
          />
        </SettingRow>
      </SettingsForm>

      <SettingsForm
        action={setSavedLogins}
        title="Saved logins"
        description="After signing in, people can save their login info on that browser and come back with one tap instead of their password."
        risks={[
          {
            name: "savedLoginsAdmins",
            when: "checked",
            message:
              "Anyone who can use a browser where an admin saved their login can open the admin pages without a password. Two-factor still applies to admins who have it.",
          },
        ]}
      >
        <SettingRow
          id="saved-logins"
          label="Allow saved logins"
          htmlFor="savedLogins"
          hint="Two-factor is still asked. Saved logins stop working after 90 days unused, or when the password changes."
          tip={{
            does: "Offers “Save your login info?” after sign-in, then shows saved accounts on the sign-in page.",
            affects:
              "Members, and admins when the next switch is on. Turning this off makes every saved login stop working.",
            default: "On",
          }}
          reset={reset("savedLogins")}
        >
          <input
            type="checkbox"
            id="savedLogins"
            name="savedLogins"
            defaultChecked={s.savedLogins}
            className={`${CHECK} self-start sm:self-end`}
          />
        </SettingRow>
        <SettingRow
          id="saved-logins-admins"
          label="Let owners and admins save logins"
          htmlFor="savedLoginsAdmins"
          hint="Off keeps admin accounts on their password every time."
          tip={{
            does: "Lets accounts that can change this Nimbus use saved logins too.",
            affects: "The owner and admins.",
            default: "Off",
          }}
          reset={reset("savedLoginsAdmins")}
        >
          <input
            type="checkbox"
            id="savedLoginsAdmins"
            name="savedLoginsAdmins"
            defaultChecked={s.savedLoginsAdmins}
            className={`${CHECK} self-start sm:self-end`}
          />
        </SettingRow>
      </SettingsForm>

      <SettingsForm
        action={setPasswordPolicy}
        title="Password rules"
        description="Rules for new account passwords and vault passphrases. Existing ones keep working until they're changed."
      >
        <SettingRow
          id="password-rules"
          label="Set my own rules"
          htmlFor="pw-custom"
          hint="Off uses the industry standard (NIST): at least 10 characters for passwords and 12 for passphrases, no forced mix, and a meter that flags guessable ones."
          tip={{
            does: "Replaces the standard rules with a minimum length, required character types and banned characters you choose.",
            affects: "Passwords and vault passphrases chosen from now on.",
            default: "Off (NIST standard)",
          }}
          reset={reset("passwordPolicy")}
        >
          <input
            type="checkbox"
            id="pw-custom"
            name="custom"
            defaultChecked={Boolean(s.passwordPolicy)}
            className={`${CHECK} self-start sm:self-end`}
          />
        </SettingRow>
        <div className="hidden divide-y group-has-[#pw-custom:checked]:block">
          <SettingRow
            id="password-length"
            label="Minimum length"
            htmlFor="pw-min"
            tip={{
              does: "The fewest characters a new password or passphrase may have.",
              affects: "Passwords and vault passphrases chosen from now on.",
              default: "12",
              example: "14 for a team that stores sensitive files",
            }}
          >
            <Input
              id="pw-min"
              name="min"
              type="number"
              min={POLICY_MIN}
              max={POLICY_MAX}
              step={1}
              defaultValue={s.passwordPolicy?.min ?? 12}
            />
          </SettingRow>
          <SettingRow
            id="password-mix"
            label="Must contain"
            hint="Forced mixes tend to make passwords more predictable, not less. Length does more."
            stacked
          >
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Must contain</legend>
              {(
                [
                  ["lower", "A lowercase letter"],
                  ["upper", "An uppercase letter"],
                  ["digit", "A number"],
                  ["symbol", "A symbol"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={s.passwordPolicy?.[key]}
                    className={CHECK}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </SettingRow>
          <SettingRow
            id="password-exclude"
            label="Characters not allowed"
            htmlFor="pw-exclude"
            hint="Type them together. A space counts too."
            tip={{
              does: "Rejects passwords that contain any of these characters, for systems that can't handle them.",
              affects: "Passwords and vault passphrases chosen from now on.",
              default: "None",
              example: "\"'`",
            }}
          >
            <Input
              id="pw-exclude"
              name="exclude"
              maxLength={64}
              defaultValue={s.passwordPolicy?.exclude ?? ""}
              placeholder="None"
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
            />
          </SettingRow>
        </div>
      </SettingsForm>

      <Section
        title="Single sign-on (OIDC)"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {oidc.source === "env"
              ? "Set in env, so it's read-only here."
              : "One OpenID Connect provider, like Authentik or Keycloak. New people who sign in with it skip approval, unless sign-ups are closed. It links to an existing account only when that account's email is confirmed."}
            {oidc.source === "env" && (
              <Badge variant="outline">From environment</Badge>
            )}
          </span>
        }
      >
        <div id="oidc-callback" className="grid scroll-mt-24 gap-2 p-4">
          <p className="text-sm font-medium">Redirect URL</p>
          <p className="text-sm text-muted-foreground">
            Register this in your provider. It must match exactly.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-input/20 px-3 py-1.5 font-mono text-xs">
              {callback}
            </code>
            <CopyButton value={callback} />
          </div>
        </div>
        <div id="oidc" className="scroll-mt-24 p-4">
          {oidc.source === "env" ? (
            <OidcEnv c={oidc} />
          ) : (
            <OidcForm
              values={{
                name: s.oidcName ?? "",
                issuer: s.oidcIssuer ?? "",
                clientId: s.oidcClientId ?? "",
                hasSecret: Boolean(s.oidcClientSecret),
                sealedSecretLost: oidc.sealedSecretLost,
                only: s.oidcOnly,
                ready: oidcReady(oidc),
              }}
            />
          )}
        </div>
      </Section>
    </AdminPage>
  )
}
