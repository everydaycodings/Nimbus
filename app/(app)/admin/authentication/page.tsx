import Link from "next/link"

import {
  AdminPage,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { Input } from "@/components/ui/input"
import { POLICY_MAX, POLICY_MIN } from "@/lib/password-policy"
import { hasPassword, requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { setPasswordPolicy, setRequire2fa } from "../actions"

export const metadata = { title: "Authentication · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary"

export default async function AuthenticationPage() {
  const me = await requireAdmin()
  // Mirrors setRequire2fa: you can't require what you don't use yourself.
  const needsOwn2fa = !me.twoFactorEnabled && (await hasPassword(me.id))
  const s = await getSettings()
  const reset = resettable(s)
  const blocked = needsOwn2fa && !s.require2fa

  return (
    <AdminPage
      title="Authentication"
      description="How people prove who they are when they sign in with a password."
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
    </AdminPage>
  )
}
