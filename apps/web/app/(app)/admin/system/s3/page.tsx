import { BucketChips } from "@/components/buckets/bucket-chips"
import {
  AdminPage,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
} from "@/components/admin/setting"
import { ConfirmAction } from "@/components/admin/registry-actions"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { KeyBadges } from "@/components/buckets/key-badges"
import { SELECT, sizeField } from "@/components/admin/setting"
import { topBuckets, usageByMember } from "@/lib/s3api/bucket-config"
import { listKeys } from "@/lib/s3api/manage"
import { permsLabel } from "@/lib/s3api/perms"
import { endpoint } from "@/lib/s3api/rules"
import { getSettings } from "@/lib/signup"
import { revokeS3Key, setS3 } from "../../actions"
import { setS3Buckets } from "./actions"
import { KeyToggle } from "./key-toggle"
import { TopBuckets, UsageByMember } from "./usage-tables"

export const metadata = { title: "S3 API · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"
const when = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
})
const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export default async function S3Page() {
  const url = endpoint()
  if (!url)
    return (
      <AdminPage
        title="S3 API"
        description="Lets members use their folders as S3 buckets from the AWS CLI, rclone, restic, Terraform and similar tools."
      >
        <div
          id="allow-s3"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-16 text-center"
        >
          <p className="font-medium">Not set up</p>
          <p className="max-w-md text-sm text-pretty text-muted-foreground">
            This server was set up without S3. Re-run{" "}
            <code className="font-mono">setup.sh</code> and answer yes to the S3
            question; it adds the S3 address and its certificate. This page then
            shows the switch and every access key.
          </p>
        </div>
      </AdminPage>
    )

  const [s, keys, members, top] = await Promise.all([getSettings(), listKeys(null), usageByMember(), topBuckets()])
  const reset = resettable(s)
  const quota = sizeField(s.s3DefaultQuota, "GB", "TB")

  return (
    <AdminPage
      title="S3 API"
      description={`Members use their folders as S3 buckets at ${url}, signing in with access keys from S3 buckets. ${keys.length === 1 ? "1 access key exists" : `${keys.length} access keys exist`}.`}
    >
      <SettingsForm action={setS3}>
        <SettingRow
          id="allow-s3"
          label="Allow the S3 API"
          htmlFor="s3Api"
          hint="Turn it off for one member from their page in Members."
          tip={{
            does: "Lets S3 tools list, read and write the folders members marked as buckets, using an access key.",
            affects:
              "Everyone. Off makes every S3 request fail, without deleting keys or buckets.",
            default: "On",
          }}
          reset={reset("s3Api")}
        >
          <input
            type="checkbox"
            id="s3Api"
            name="s3Api"
            defaultChecked={s.s3Api}
            className={CHECK}
          />
        </SettingRow>
        <SettingRow
          id="s3-rate-limit"
          label="Requests per second, per key"
          htmlFor="s3RpsLimit"
          hint="Blank means no limit."
          tip={{
            does: "Slows down a key that sends more requests per second than this. Extra requests get a SlowDown answer, which S3 tools retry on their own.",
            affects: "Each access key separately, from the next request.",
            default: "No limit",
            example: "100",
          }}
          reset={reset("s3RpsLimit")}
        >
          <Input
            id="s3RpsLimit"
            name="s3RpsLimit"
            type="number"
            min={1}
            max={100000}
            step={1}
            defaultValue={s.s3RpsLimit ?? ""}
            placeholder="No limit"
          />
        </SettingRow>
      </SettingsForm>

      <SettingsForm action={setS3Buckets} title="Buckets">
        <SettingRow
          id="s3-public"
          label="Allow public buckets"
          htmlFor="s3PublicAllowed"
          hint="Members can then share a bucket's files with anyone who has the link. Listing stays off."
          warning="Public files can be downloaded by anyone, and the downloads count toward your bandwidth."
          tip={{
            does: "Lets members turn on public read for their own buckets. Turning it off makes every public link stop working until it's back on.",
            affects: "Every bucket that is already public, at once.",
            default: "Off",
          }}
          reset={reset("s3PublicAllowed")}
        >
          <input type="checkbox" id="s3PublicAllowed" name="s3PublicAllowed" defaultChecked={s.s3PublicAllowed} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="s3-default-quota"
          label="Default bucket quota"
          htmlFor="s3DefaultQuota"
          hint="For buckets without their own limit. Blank means no limit."
          tip={{
            does: "Uploads that would take a bucket past this size fail with QuotaExceeded.",
            affects: "Buckets whose owner hasn't set a limit; their own limit wins.",
            default: "No limit",
            example: "50 GB",
          }}
          reset={reset("s3DefaultQuota")}
        >
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Input id="s3DefaultQuota" name="s3DefaultQuota" type="number" min={0.01} step="any" defaultValue={quota.value} placeholder="No limit" />
            <select key={quota.unit} aria-label="Unit" name="unit" defaultValue={quota.unit === "TB" ? "TB" : "GB"} className={SELECT}>
              <option value="GB">GB</option>
              <option value="TB">TB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>

      <UsageByMember rows={members} />
      <TopBuckets rows={top} />

      <section id="s3-keys" className="flex scroll-mt-24 flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            All access keys{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              {keys.length}
            </span>
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {s.s3Api
              ? "Revoking a key stops it at once. Buckets and files stay where they are."
              : "The S3 API is off, so none of these work right now."}
          </p>
        </div>
        {keys.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No one has made an access key yet.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                      <span className="truncate">{k.name}</span>
                      <Badge variant="outline">{permsLabel(k.perms)}</Badge>
                      <KeyBadges k={k} />
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {k.member} ·{" "}
                      <code className="font-mono text-xs">{k.accessKeyId}</code>
                    </p>
                  </div>
                  <div className="grid basis-64 gap-1 text-sm text-muted-foreground">
                    <div>
                      {k.allBuckets ? "All buckets" : k.buckets.length ? <BucketChips names={k.buckets} /> : "No buckets left"}
                    </div>
                    <span className="tabular-nums">
                      {k.lastUsedAt
                        ? `Used ${when.format(new Date(k.lastUsedAt))}${k.lastIp ? ` from ${k.lastIp}` : ""}`
                        : "Never used"}{" "}
                      ·{" "}
                      {k.expiresAt
                        ? `${k.expired ? "Expired" : "Expires"} ${day.format(new Date(k.expiresAt))}`
                        : "Never expires"}
                    </span>
                  </div>
                  <KeyToggle id={k.id} name={k.name} disabled={k.disabled} />
                  <ConfirmAction
                    label="Revoke"
                    aria={`Revoke ${k.name}`}
                    question={`Revoke ${k.name}?`}
                    yes="Revoke key"
                    done={`Revoked ${k.name}.`}
                    run={revokeS3Key.bind(null, k.id)}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </section>
    </AdminPage>
  )
}
