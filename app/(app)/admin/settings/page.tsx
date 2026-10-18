import { XIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { desc } from "drizzle-orm"
import { headers } from "next/headers"

import { CopyButton } from "@/components/copy-button"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { db } from "@/lib/db"
import { invites, type SignupMode } from "@/lib/db/schema"
import { hasPassword, requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import {
  addBlockedExtension,
  addTrustedDomain,
  createInvite,
  removeBlockedExtension,
  removeTrustedDomain,
  revokeInvite,
  setRequire2fa,
  setSignupMode,
  setTrashRetention,
  setDefaultQuota,
  setUploadLimit,
  setVersionRetention,
  setOcrLangs,
  setOfficeUrl,
  setLinkPolicy,
} from "./actions"

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

const SELECT =
  "h-9 w-full rounded-md border border-input bg-input/30 px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

async function origin() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL
  const h = await headers()
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`
}

const UNIT_BYTES = { MB: 2 ** 20, GB: 2 ** 30, TB: 2 ** 40 }
type Unit = keyof typeof UNIT_BYTES

// A byte limit as a number-and-unit form field: the bigger unit once it's at least one of them.
function sizeField(bytes: number | null, small: Unit, big: Unit) {
  if (bytes === null) return { value: "", unit: big }
  const unit = bytes < UNIT_BYTES[big] ? small : big
  return { value: String(+(bytes / UNIT_BYTES[unit]).toFixed(2)), unit }
}

function inviteState(i: typeof invites.$inferSelect) {
  if (i.expiresAt && i.expiresAt < new Date()) return "Expired"
  if (i.maxUses !== null && i.uses >= i.maxUses) return "Used up"
  return null
}

export default async function SettingsPage() {
  const me = await requireAdmin()
  // Mirrors setRequire2fa: you can't require what you don't use yourself.
  const needsOwn2fa = !me.twoFactorEnabled && (await hasPassword(me.id))
  const {
    signupMode,
    trustedDomains,
    require2fa,
    trashRetentionDays,
    maxUploadBytes,
    blockedExtensions,
    versionKeepLast,
    versionMaxAgeDays,
    defaultQuotaBytes,
    officeUrl,
    ocrLangs,
    publicLinksEnabled,
    maxLinkDays,
    requireLinkPassword,
  } = await getSettings()
  const quota = sizeField(defaultQuotaBytes, "GB", "TB")
  const size = sizeField(maxUploadBytes, "MB", "GB")
  const links = await db.select().from(invites).orderBy(desc(invites.createdAt))
  const base = await origin()

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign-ups</CardTitle>
          <CardDescription>
            In every mode except Closed, invite links and trusted domains skip
            approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setSignupMode} className="flex flex-col gap-4">
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
                    defaultChecked={mode === signupMode}
                    className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                  />
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <SubmitButton className="self-end">Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite links</CardTitle>
          <CardDescription>
            {signupMode === "closed"
              ? "Sign-ups are closed, so these links won't work until you reopen them."
              : "Anyone with a link can create an account that's ready right away."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form
            action={createInvite}
            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="expires">Expires</Label>
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
              <Label htmlFor="maxUses">Max uses</Label>
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

          {links.length === 0 ? (
            <p className="rounded-lg border border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground">
              No invite links yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trusted domains</CardTitle>
          <CardDescription>
            People who sign in with Google or GitHub using an email at these
            domains skip approval. Email-and-password sign-ups don&apos;t count,
            because those emails aren&apos;t verified.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={addTrustedDomain} className="flex gap-2">
            <Label htmlFor="domain" className="sr-only">
              Domain
            </Label>
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
          {trustedDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trusted domains. Everyone follows the sign-up mode above.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {trustedDomains.map((d) => (
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-factor</CardTitle>
          <CardDescription>
            Two-factor protects password sign-ins with a code from an
            authenticator app. It works without email. Google and GitHub
            sign-ins rely on the provider&apos;s own two-factor instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setRequire2fa} className="flex flex-col gap-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-input/20 has-checked:border-ring/60 has-checked:bg-input/30 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-transparent">
              <input
                type="checkbox"
                name="require2fa"
                defaultChecked={require2fa}
                disabled={needsOwn2fa && !require2fa}
                className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
              />
              <span className="grid gap-1">
                <span className="text-sm font-medium">
                  Require two-factor for password accounts
                </span>
                <span className="text-sm text-muted-foreground">
                  Anyone without it, admins included, has to set it up the next
                  time they open Nimbus. Nobody can turn it off while this is
                  on.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {needsOwn2fa && !require2fa && (
                <p className="mr-auto text-sm text-muted-foreground">
                  Turn on two-factor for{" "}
                  <Link
                    href="/account"
                    className="text-foreground underline underline-offset-4"
                  >
                    your own account
                  </Link>{" "}
                  first.
                </p>
              )}
              <SubmitButton disabled={needsOwn2fa && !require2fa}>
                Save
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage</CardTitle>
          <CardDescription>
            How much each member can store, counting older versions and the
            trash. Set a different amount for someone from the ⋯ menu on
            Members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setDefaultQuota}
            className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="quota">Storage per member</Label>
              <Input
                id="quota"
                name="quota"
                type="number"
                min={0.01}
                step="any"
                defaultValue={quota.value}
                placeholder="Unlimited"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quotaUnit" className="sr-only">
                Unit
              </Label>
              <select
                id="quotaUnit"
                name="unit"
                defaultValue={quota.unit}
                className={SELECT}
              >
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploads</CardTitle>
          <CardDescription>
            Checked before any bytes move, so a refused file never takes up
            space.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form
            action={setUploadLimit}
            className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="maxSize">Largest file</Label>
              <Input
                id="maxSize"
                name="maxSize"
                type="number"
                min={0.01}
                step="any"
                defaultValue={size.value}
                placeholder="No limit"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="unit" className="sr-only">
                Unit
              </Label>
              <select
                id="unit"
                name="unit"
                defaultValue={size.unit}
                className={SELECT}
              >
                <option value="MB">MB</option>
                <option value="GB">GB</option>
              </select>
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>

          <div className="flex flex-col gap-4">
            <form action={addBlockedExtension} className="grid gap-2">
              <Label htmlFor="ext">Blocked file types</Label>
              <div className="flex gap-2">
                <Input
                  id="ext"
                  name="ext"
                  placeholder="exe"
                  required
                  pattern="\*?\.?[A-Za-z0-9_\-]{1,20}"
                  title="An extension like exe or .exe"
                  className="max-w-xs"
                />
                <SubmitButton variant="outline">Block type</SubmitButton>
              </div>
            </form>
            {blockedExtensions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every file type can be uploaded.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {blockedExtensions.map((ext) => (
                  <li
                    key={ext}
                    className="flex h-8 items-center gap-1 rounded-md border pr-1 pl-3 font-mono text-sm"
                  >
                    .{ext}
                    <form action={removeBlockedExtension.bind(null, ext)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Unblock .${ext}`}
                      >
                        <XIcon />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Versions</CardTitle>
          <CardDescription>
            Uploading a file with the same name keeps the old one as a version.
            The current version is never removed. Leave a field blank to keep
            versions without that limit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setVersionRetention}
            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="keepLast">Keep the newest</Label>
              <Input
                id="keepLast"
                name="keepLast"
                type="number"
                min={1}
                step={1}
                defaultValue={versionKeepLast ?? ""}
                placeholder="All versions"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxAgeDays">
                Delete versions older than (days)
              </Label>
              <Input
                id="maxAgeDays"
                name="maxAgeDays"
                type="number"
                min={1}
                step={1}
                defaultValue={versionMaxAgeDays ?? ""}
                placeholder="Never"
              />
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public links</CardTitle>
          <CardDescription>
            Links let anyone who has them open a file or folder without an
            account. Every link is listed under Public links, where you can
            revoke it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setLinkPolicy} className="flex flex-col gap-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={publicLinksEnabled}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                Allow public links
                <span className="block text-muted-foreground">
                  Off: no link opens, and members can&apos;t make new ones.
                  Sharing with members still works.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="requirePassword"
                defaultChecked={requireLinkPassword}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                Require a password on new links
                <span className="block text-muted-foreground">
                  Links made before this keep working as they are.
                </span>
              </span>
            </label>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Label htmlFor="maxLinkDays">Links expire within (days)</Label>
                <Input
                  id="maxLinkDays"
                  name="maxLinkDays"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  defaultValue={maxLinkDays ?? ""}
                  placeholder="No limit"
                />
              </div>
              <SubmitButton>Save</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Office documents</CardTitle>
          <CardDescription>
            With a Collabora Online server, Word, Excel, PowerPoint and
            OpenDocument files open in it, read-only. Leave blank to use the
            built-in viewers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setOfficeUrl}
            className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="officeUrl">Collabora URL</Label>
              <Input
                id="officeUrl"
                name="officeUrl"
                type="url"
                defaultValue={officeUrl ?? ""}
                placeholder="https://office.example.com"
              />
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Text in images</CardTitle>
          <CardDescription>
            Search reads the words in photos and screenshots up to 20 MB, in the
            browser of whoever uploads or opens them. List the languages
            they&apos;re written in as Tesseract codes, like eng, deu, fra or
            chi_sim. Each extra language makes reading slower.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setOcrLangs}
            className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="ocrLangs">Languages</Label>
              <Input
                id="ocrLangs"
                name="ocrLangs"
                defaultValue={ocrLangs.split("+").join(", ")}
                placeholder="eng"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trash</CardTitle>
          <CardDescription>
            Applies to everyone&apos;s trash. Members can always restore, delete
            forever or empty the trash themselves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={setTrashRetention}
            className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"
          >
            <div className="grid gap-2">
              <Label htmlFor="retention">Delete trashed items for good</Label>
              <select
                id="retention"
                name="retention"
                defaultValue={String(trashRetentionDays ?? 0)}
                className={SELECT}
              >
                <option value="0">Never, keep them until emptied</option>
                <option value="7">After 7 days</option>
                <option value="30">After 30 days</option>
                <option value="90">After 90 days</option>
              </select>
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
