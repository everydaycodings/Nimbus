import { XIcon } from "@phosphor-icons/react/dist/ssr"
import { desc } from "drizzle-orm"
import { headers } from "next/headers"

import {
  AdminPage,
  SELECT,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { CopyButton } from "@/components/copy-button"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { db } from "@/lib/db"
import { invites, type SignupMode } from "@/lib/db/schema"
import { getSettings } from "@/lib/signup"
import {
  addTrustedDomain,
  createInvite,
  removeTrustedDomain,
  revokeInvite,
  setSignupMode,
} from "../actions"

export const metadata = { title: "Sign-ups & invites · Admin · Nimbus" }

const MODES: { mode: SignupMode; label: string; hint: string }[] = [
  {
    mode: "approval",
    label: "Approval",
    hint: "Anyone can create an account. An admin approves it before it can store files.",
  },
  {
    mode: "invite",
    label: "Invite only",
    hint: "People join through an invite link, and their account is ready right away.",
  },
  {
    mode: "open",
    label: "Open",
    hint: "Anyone who signs up gets an account right away.",
  },
  {
    mode: "closed",
    label: "Closed",
    hint: "No new accounts. Existing members keep their access.",
  },
]

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

async function origin() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL
  const h = await headers()
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`
}

function inviteState(i: typeof invites.$inferSelect) {
  if (i.expiresAt && i.expiresAt < new Date()) return "Expired"
  if (i.maxUses !== null && i.uses >= i.maxUses) return "Used up"
  return null
}

export default async function SignupsPage() {
  const s = await getSettings()
  const reset = resettable(s)
  const links = await db.select().from(invites).orderBy(desc(invites.createdAt))
  const base = await origin()

  return (
    <AdminPage
      title="Sign-ups & invites"
      description="Decide who can create an account on this Nimbus, and hand out links that let people skip the line."
    >
      <SettingsForm
        action={setSignupMode}
        risks={[
          {
            name: "mode",
            when: "equals",
            value: "open",
            message:
              "Anyone who finds this Nimbus can create an account and start storing files, with no admin check.",
          },
        ]}
      >
        <SettingRow
          id="signup-mode"
          label="Sign-up mode"
          hint="In every mode except Closed, invite links and trusted domains skip approval."
          tip={{
            does: "Controls what happens when someone new creates an account from the sign-up page.",
            affects: "New sign-ups only. Existing members are never changed.",
            default: "Approval",
          }}
          reset={reset("signupMode")}
          stacked
        >
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Sign-up mode</legend>
            {MODES.map(({ mode, label, hint }) => (
              <label
                key={mode}
                className="flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-input/20 has-checked:border-ring/60 has-checked:bg-input/30 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="mode"
                  value={mode}
                  defaultChecked={mode === s.signupMode}
                  className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                />
                <span className="grid gap-1">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </SettingRow>
      </SettingsForm>

      <Section
        title="Invite links"
        description={
          s.signupMode === "closed"
            ? "Sign-ups are closed, so these links won't work until you reopen them."
            : "Anyone with a link can create an account that's ready right away."
        }
      >
        <SettingRow
          id="invite-links"
          label="New invite link"
          tip={{
            does: "Makes a link you can send to someone. Opening it lets them create an account without waiting for approval.",
            affects: "Only people who receive the link.",
            default: "Expires after 7 days, unlimited uses",
            example: "One link with 1 use per person you invite",
          }}
          stacked
        >
          <form
            action={createInvite}
            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div className="grid gap-2">
              <label
                htmlFor="expires"
                className="text-sm text-muted-foreground"
              >
                Expires
              </label>
              <select
                id="expires"
                name="expires"
                defaultValue="7"
                className={SELECT}
              >
                <option value="1">After 1 day</option>
                <option value="7">After 7 days</option>
                <option value="30">After 30 days</option>
                <option value="0">Never</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label
                htmlFor="maxUses"
                className="text-sm text-muted-foreground"
              >
                Max uses
              </label>
              <Input
                id="maxUses"
                name="maxUses"
                type="number"
                min={1}
                placeholder="Unlimited"
              />
            </div>
            <SubmitButton>Create link</SubmitButton>
          </form>
        </SettingRow>
        {links.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No invite links yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {links.map((i) => {
              const url = `${base}/invite/${i.token}`
              const state = inviteState(i)
              return (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <div className="grid min-w-0 flex-1 basis-56 gap-1">
                    <p className="truncate font-mono text-sm">{url}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      {state && <Badge variant="secondary">{state}</Badge>}
                      <span>
                        {i.uses}
                        {i.maxUses === null
                          ? ` use${i.uses === 1 ? "" : "s"}`
                          : ` of ${i.maxUses} uses`}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {i.expiresAt
                          ? `${state === "Expired" ? "Expired" : "Expires"} ${date.format(i.expiresAt)}`
                          : "Never expires"}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!state && <CopyButton value={url} />}
                    <form action={revokeInvite.bind(null, i.id)}>
                      <SubmitButton variant="destructive" size="sm">
                        {state ? "Delete" : "Revoke"}
                      </SubmitButton>
                    </form>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Trusted domains">
        <SettingRow
          id="trusted-domains"
          label="Trusted domains"
          htmlFor="domain"
          hint="Google and GitHub sign-ins from these domains skip approval."
          tip={{
            does: "People who sign in with Google or GitHub using an email at one of these domains get an account right away. Email-and-password sign-ups don't count, because those emails aren't verified.",
            affects: "New Google and GitHub sign-ups.",
            default: "None",
            example: "example.com",
          }}
          stacked
        >
          <form action={addTrustedDomain} className="flex gap-2">
            <Input
              id="domain"
              name="domain"
              placeholder="example.com"
              required
              pattern="@?[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+"
              title="A domain like example.com"
              className="max-w-xs"
            />
            <SubmitButton variant="outline">Add domain</SubmitButton>
          </form>
          {s.trustedDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trusted domains. Everyone follows the sign-up mode.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {s.trustedDomains.map((d) => (
                <li
                  key={d}
                  className="flex h-8 items-center gap-1 rounded-md border pr-1 pl-3 font-mono text-sm"
                >
                  {d}
                  <form action={removeTrustedDomain.bind(null, d)}>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${d}`}
                    >
                      <XIcon />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </SettingRow>
      </Section>
    </AdminPage>
  )
}
