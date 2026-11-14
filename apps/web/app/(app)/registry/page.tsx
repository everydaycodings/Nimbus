import { PackageIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { ClaimName, RegistryView } from "@/components/registry-view"
import {
  MAX_TOKENS,
  listOrgs,
  listRepos,
  listTokens,
  myNamespace,
  registryState,
  type RegistryState,
} from "@/lib/registry/manage"
import { endpoint, registryNameError } from "@/lib/registry/rules"
import { isAdmin, requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

export const metadata = { title: "Container registry · Nimbus" }

const LINK =
  "rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

const COPY = (admin: boolean): Record<Exclude<RegistryState, "ready" | "unclaimed">, { title: string; body: React.ReactNode }> => ({
  unset: {
    title: "The registry isn't set up on this server",
    body: admin
      ? "Re-run setup.sh and answer yes to the container registry question. Nimbus then serves a registry address and this page starts working."
      : "An admin has to turn it on when setting up Nimbus. Ask them if you need it.",
  },
  off: {
    title: "The registry is turned off",
    body: admin ? (
      <>
        You turned the registry off for everyone. Turn it back on in{" "}
        <Link href="/admin/system/registry" className={LINK}>
          Admin → Container registry
        </Link>
        .
      </>
    ) : (
      "An admin turned the registry off. Your repositories and tokens are kept and work again when it's back on."
    ),
  },
  disabled: {
    title: "The registry is off for your account",
    body: "An admin turned it off for you, and your tokens were removed. Ask them if you need it back.",
  },
})

// A starting name from the email's local part: lowercase, hyphens, 2 to 39 characters.
function suggest(email: string) {
  const s = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39)
    .replace(/-+$/, "")
  return s && !registryNameError(s) ? s : ""
}

export default async function RegistryPage() {
  const me = await requireMember()
  const state = await registryState(me.id)
  if (state === "unclaimed") return <ClaimName suggestion={suggest(me.email)} />
  if (state !== "ready") {
    const { title, body } = COPY(isAdmin(me.role))[state]
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Container registry</h1>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-16 text-center">
          <PackageIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">{title}</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">{body}</p>
        </div>
      </div>
    )
  }
  const [ns, repos, orgs, tokens, s] = await Promise.all([
    myNamespace(me.id),
    listRepos(me.id),
    listOrgs(me.id),
    listTokens(me.id),
    getSettings(),
  ])
  return (
    <RegistryView
      me={ns!.name}
      meId={me.id}
      host={endpoint()!.replace(/^https?:\/\//, "")}
      repos={repos}
      orgs={orgs}
      tokens={tokens}
      maxTokens={MAX_TOKENS}
      canCreateOrg={s.registryOrgCreate === "anyone" || isAdmin(me.role)}
      publicAllowed={s.registryPublic}
    />
  )
}
