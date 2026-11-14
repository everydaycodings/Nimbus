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
import { listKeys } from "@/lib/s3api/manage"
import { endpoint } from "@/lib/s3api/rules"
import { getSettings } from "@/lib/signup"
import { revokeS3Key, setS3 } from "../../actions"

export const metadata = { title: "S3 API · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"
const ACCESS = { rw: "Read & write", ro: "Read only" }
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

  const [s, keys] = await Promise.all([getSettings(), listKeys(null)])
  const reset = resettable(s)

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
                      <Badge variant="outline">{ACCESS[k.access]}</Badge>
                      {k.expired && <Badge variant="secondary">Expired</Badge>}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {k.member} ·{" "}
                      <code className="font-mono text-xs">{k.accessKeyId}</code>
                    </p>
                  </div>
                  <p className="basis-64 text-sm text-muted-foreground">
                    {k.allBuckets
                      ? "All buckets"
                      : k.buckets.length
                        ? k.buckets.join(", ")
                        : "No buckets left"}
                    <br />
                    <span className="tabular-nums">
                      {k.lastUsedAt
                        ? `Used ${when.format(new Date(k.lastUsedAt))}${k.lastIp ? ` from ${k.lastIp}` : ""}`
                        : "Never used"}{" "}
                      ·{" "}
                      {k.expiresAt
                        ? `${k.expired ? "Expired" : "Expires"} ${day.format(new Date(k.expiresAt))}`
                        : "Never expires"}
                    </span>
                  </p>
                  <form action={revokeS3Key.bind(null, k.id)}>
                    <SubmitButton size="sm" variant="destructive">
                      Revoke
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </section>
    </AdminPage>
  )
}
