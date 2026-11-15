import {
  AdminPage,
  SELECT,
  Section,
  SettingRow,
  SettingsForm,
  resettable,
  sizeField,
  speedField,
} from "@/components/admin/setting"
import { GcCard, MirrorsAdmin } from "@/components/admin/registry-admin"
import { SubmitButton } from "@/components/submit-button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { formatBytes } from "@/lib/file-rules"
import { adminNamespaces, adminRepos, adminUpstreams, listTokens } from "@/lib/registry/manage"
import { endpoint } from "@/lib/registry/rules"
import { getSettings } from "@/lib/signup"
import { deleteRegistryRepo, revokeRegistryToken, setRegistry, setRegistryQuota } from "../../actions"

export const metadata = { title: "Container registry · Admin · Nimbus" }

const CHECK = "size-4 shrink-0 accent-primary self-start sm:self-end"
const ACCESS = { pull: "Pull only", push: "Pull & push" }
const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

export default async function RegistryAdminPage() {
  const url = endpoint()
  if (!url)
    return (
      <AdminPage
        title="Container registry"
        description="Lets members push and pull Docker and OCI images from their own registry names."
      >
        <div id="allow-registry" className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-16 text-center">
          <p className="font-medium">Not set up</p>
          <p className="max-w-md text-sm text-pretty text-muted-foreground">
            This server was set up without the registry. Re-run <code className="font-mono">setup.sh</code> and answer yes to
            the container registry question; it adds the registry address and its certificate. This page then shows the
            switches, every repository and every token.
          </p>
        </div>
      </AdminPage>
    )

  const [s, repos, tokens, namespaces, upstreams] = await Promise.all([
    getSettings(),
    adminRepos(),
    listTokens(null),
    adminNamespaces(),
    adminUpstreams(),
  ])
  const reset = resettable(s)
  const quota = sizeField(s.registryDefaultQuotaBytes, "GB", "TB")
  const bps = speedField(s.registryBpsLimit)

  return (
    <AdminPage
      title="Container registry"
      description={`Members push and pull images at ${url.replace(/^https?:\/\//, "")}, signing in with tokens from Registry. ${repos.length === 1 ? "1 repository" : `${repos.length} repositories`}, ${tokens.length === 1 ? "1 token" : `${tokens.length} tokens`}.`}
    >
      <SettingsForm action={setRegistry}>
        <SettingRow
          id="allow-registry"
          label="Allow the registry"
          htmlFor="registry"
          hint="Turn it off for one member from their page in Members."
          tip={{
            does: "Lets members push and pull images with Docker, Podman, containerd and similar tools, using a token.",
            affects: "Everyone. Off makes every registry request fail, without deleting repositories or tokens.",
            default: "On",
          }}
          reset={reset("registry")}
        >
          <input type="checkbox" id="registry" name="registry" defaultChecked={s.registry} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="registry-public"
          label="Allow public repositories"
          htmlFor="registryPublic"
          hint="Members can make a repository pullable without signing in."
          tip={{
            does: "Lets repository owners switch a repository to public. Anyone can then pull it without signing in.",
            affects: "Off hides every public repository from anonymous pulls at once, without changing their setting.",
            default: "On",
          }}
          reset={reset("registryPublic")}
        >
          <input type="checkbox" id="registryPublic" name="registryPublic" defaultChecked={s.registryPublic} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="registry-redirect"
          label="Send image downloads straight to storage"
          htmlFor="registryRedirect"
          hint="Pulls download layers from S3 through a short-lived link instead of through Nimbus."
          tip={{
            does: "Answers layer downloads with a redirect to a presigned storage link, so big pulls skip the Nimbus server.",
            affects: "Every pull. The storage address must be reachable from the machines that pull.",
            default: "Off",
          }}
          reset={reset("registryRedirect")}
        >
          <input type="checkbox" id="registryRedirect" name="registryRedirect" defaultChecked={s.registryRedirect} className={CHECK} />
        </SettingRow>
        <SettingRow
          id="registry-rate-limit"
          label="Requests per second, per token"
          htmlFor="registryRpsLimit"
          hint="Blank means no limit."
          tip={{
            does: "Slows down a token that sends more requests per second than this. Extra requests get a 429 answer, which Docker retries.",
            affects: "Each token separately, from the next request.",
            default: "No limit",
            example: "50",
          }}
          reset={reset("registryRpsLimit")}
        >
          <Input
            id="registryRpsLimit"
            name="registryRpsLimit"
            type="number"
            min={1}
            max={100000}
            step={1}
            defaultValue={s.registryRpsLimit ?? ""}
            placeholder="No limit"
          />
        </SettingRow>
        <SettingRow
          id="registry-bandwidth"
          label="Bandwidth, per token"
          htmlFor="registryBps"
          hint="Caps how fast one token downloads. Blank means no cap."
          tip={{
            does: "Slows each token's downloads to this speed.",
            affects: "Each token separately, from the next request.",
            default: "No cap",
            example: "20 MB/s",
          }}
          reset={reset("registryBpsLimit")}
        >
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Input id="registryBps" name="registryBps" type="number" min={0.01} step="any" defaultValue={bps.value} placeholder="No cap" />
            <select key={bps.unit} aria-label="Unit" name="bpsUnit" defaultValue={bps.unit} className={SELECT}>
              <option value="KB">KB/s</option>
              <option value="MB">MB/s</option>
            </select>
          </div>
        </SettingRow>
        <SettingRow
          id="registry-org-create"
          label="Who can create orgs"
          htmlFor="registryOrgCreate"
          hint="Orgs are shared registry names with their own members."
          tip={{
            does: "Decides whether any member can make an org, or only admins.",
            affects: "New orgs only. Existing orgs stay.",
            default: "Anyone",
          }}
          reset={reset("registryOrgCreate")}
        >
          <select id="registryOrgCreate" name="registryOrgCreate" defaultValue={s.registryOrgCreate} className={SELECT}>
            <option value="anyone">Any member</option>
            <option value="admins">Only admins</option>
          </select>
        </SettingRow>
        <SettingRow
          id="registry-default-quota"
          label="Registry storage per name"
          htmlFor="quota"
          hint="Counts each name's images and trashed repositories, separate from Drive storage. Blank means no limit."
          tip={{
            does: "Caps the space one registry name (a member or an org) can use. Pushes that would go over are refused.",
            affects: "Every name without its own amount, set in the list below. The owner is never limited.",
            default: "No limit",
            example: "20 GB",
          }}
          reset={reset("registryDefaultQuotaBytes")}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input id="quota" name="quota" type="number" min={0.01} step="any" defaultValue={quota.value} placeholder="No limit" />
            <select key={quota.unit} aria-label="Unit" name="quotaUnit" defaultValue={quota.unit} className={SELECT}>
              <option value="GB">GB</option>
              <option value="TB">TB</option>
            </select>
          </div>
        </SettingRow>
      </SettingsForm>

      <MirrorsAdmin upstreams={upstreams} host={url.replace(/^https?:\/\//, "")} />

      <GcCard />

      <section id="registry-names" className="flex scroll-mt-24 flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            Registry names <span className="font-normal text-muted-foreground tabular-nums">{namespaces.length}</span>
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Give a name its own storage limit. Blank follows the default above.
          </p>
        </div>
        {namespaces.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No one has claimed a registry name yet.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {namespaces.map((n) => {
                const q = sizeField(n.quotaBytes, "GB", "TB")
                return (
                  <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="truncate font-mono">{n.name}</span>
                        <Badge variant="outline">{n.kind === "org" ? "Org" : "Member"}</Badge>
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums">{formatBytes(n.used)} used</p>
                    </div>
                    <form action={setRegistryQuota} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={n.id} />
                      <Input
                        name="quota"
                        type="number"
                        min={0.01}
                        step="any"
                        aria-label={`Storage limit for ${n.name}`}
                        defaultValue={q.value}
                        placeholder="Default"
                        className="w-32"
                      />
                      <select key={q.unit} aria-label="Unit" name="unit" defaultValue={q.unit} className={SELECT + " w-20"}>
                        <option value="GB">GB</option>
                        <option value="TB">TB</option>
                      </select>
                      <SubmitButton size="sm" variant="outline">
                        Save
                      </SubmitButton>
                    </form>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}
      </section>

      <section id="registry-repos" className="flex scroll-mt-24 flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            All repositories <span className="font-normal text-muted-foreground tabular-nums">{repos.length}</span>
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Deleting a repository removes it and its tags from view for everyone.
          </p>
        </div>
        {repos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No one has pushed an image yet.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {repos.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate font-mono">{r.fullName}</span>
                      <Badge variant="outline">{r.isPublic ? "Public" : "Private"}</Badge>
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {r.tags === 1 ? "1 tag" : `${r.tags} tags`} · {formatBytes(r.bytes)}
                    </p>
                  </div>
                  <form action={deleteRegistryRepo.bind(null, r.id)}>
                    <SubmitButton size="sm" variant="destructive">
                      Delete
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </section>

      <section id="registry-tokens" className="flex scroll-mt-24 flex-col gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">
            All tokens <span className="font-normal text-muted-foreground tabular-nums">{tokens.length}</span>
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {s.registry
              ? "Revoking a token stops it at once. Repositories stay where they are."
              : "The registry is off, so none of these work right now."}
          </p>
        </div>
        {tokens.length === 0 ? (
          <p className="rounded-xl border border-dashed border-input px-6 py-12 text-center text-sm text-muted-foreground">
            No one has made a token yet.
          </p>
        ) : (
          <Section>
            <ul className="flex flex-col divide-y">
              {tokens.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                      <span className="truncate">{k.name}</span>
                      <Badge variant="outline">{ACCESS[k.access]}</Badge>
                      {k.expired && <Badge variant="secondary">Expired</Badge>}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {k.member} · <code className="font-mono text-xs">{k.prefix}…</code>
                    </p>
                  </div>
                  <p className="basis-64 text-sm text-muted-foreground">
                    {k.allRepos ? "All repositories" : k.repos.length ? k.repos.join(", ") : "No repositories left"}
                    <br />
                    <span className="tabular-nums">
                      {k.lastUsedAt ? `Used ${when.format(new Date(k.lastUsedAt))}${k.lastIp ? ` from ${k.lastIp}` : ""}` : "Never used"} ·{" "}
                      {k.expiresAt ? `${k.expired ? "Expired" : "Expires"} ${day.format(new Date(k.expiresAt))}` : "Never expires"}
                    </span>
                  </p>
                  <form action={revokeRegistryToken.bind(null, k.id)}>
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
