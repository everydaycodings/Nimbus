import { GitBranchIcon, GithubLogoIcon, GitlabLogoIcon, GitForkIcon, type Icon } from "@phosphor-icons/react"

import type { Provider } from "@/lib/gitbackup/refs"

// A permission the token needs: its name as the host's token page shows it, and why Nimbus wants it.
type Perm = { name: string; why: string }

// What the connect form says per git host: the permissions to tick (need), the extra one for backups on
// push, and the snags that stop a token from working. Phosphor has no Gitea or Forgejo mark, so those get
// neutral git icons.
export const PROVIDERS: Record<Provider, { label: string; icon: Icon; placeholder: string; need: Perm[]; push: Perm[]; tips: string[]; link: (server: string) => string; linkText: string; hint: string }> = {
  github: {
    label: "GitHub",
    icon: GithubLogoIcon,
    placeholder: "ghp_…",
    need: [
      { name: "repo", why: "read and clone your repos, private ones included" },
      { name: "read:org", why: "list the repos of organizations you belong to" },
    ],
    push: [{ name: "admin:repo_hook", why: "add the webhook that starts a backup on push" }],
    tips: [
      "Use a classic token. A fine-grained one works too: pick each account or organization as its owner (one token each), All repositories, and Contents: Read-only (plus Webhooks: Read and write for backups on push). Organizations may have to approve it.",
      "If an organization uses SAML single sign-on, open the token after creating it and choose Configure SSO, then Authorize for that organization. Without this its repos stay hidden.",
      "Pick an expiry date. Nimbus warns you 7 days before it runs out.",
    ],
    link: () => "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Nimbus%20Git%20Backup",
    linkText: "Create one on GitHub",
    hint: "github.com or GitHub Enterprise",
  },
  gitlab: {
    label: "GitLab",
    icon: GitlabLogoIcon,
    placeholder: "glpat-…",
    need: [
      { name: "read_api", why: "list your projects, groups and subgroups, and check the token's expiry" },
      { name: "read_repository", why: "clone your projects, private ones included" },
    ],
    push: [{ name: "api", why: "add the webhook that starts a backup on push; you need the Maintainer role on each project" }],
    tips: [
      "Use a personal access token. Group and project access tokens work too, but see only their own group or project.",
      "GitLab tokens always expire (a year at most). Nimbus warns you 7 days before.",
      "On your own GitLab server, backups on push also need Admin → Settings → Network → Outbound requests to allow Nimbus's address.",
    ],
    link: (s) => `${s || "https://gitlab.com"}/-/user_settings/personal_access_tokens?name=Nimbus%20Git%20Backup&scopes=read_api,read_repository`,
    linkText: "Create one on GitLab",
    hint: "gitlab.com or self-hosted",
  },
  gitea: {
    label: "Gitea",
    icon: GitBranchIcon,
    placeholder: "Access token",
    need: [
      { name: "repository: Read", why: "list and clone your repos, private ones included" },
      { name: "organization: Read", why: "list the repos of organizations you belong to" },
      { name: "user: Read", why: "check whose token it is" },
    ],
    push: [{ name: "repository: Read and Write", why: "add the webhook that starts a backup on push; you need admin rights on each repo" }],
    tips: [
      "Create it under Settings → Applications → Generate new token, and set the permissions above under Select permissions.",
      "These tokens don't expire. Delete it on the same page when you no longer need it.",
      "Backups on push also need the server to allow webhooks to Nimbus's address ([webhook] ALLOWED_HOST_LIST in its app.ini).",
    ],
    link: (s) => (s ? `${s}/user/settings/applications` : ""),
    linkText: "Open your Gitea applications page",
    hint: "Self-hosted",
  },
  forgejo: {
    label: "Forgejo",
    icon: GitForkIcon,
    placeholder: "Access token",
    need: [
      { name: "repository: Read", why: "list and clone your repos, private ones included" },
      { name: "organization: Read", why: "list the repos of organizations you belong to" },
      { name: "user: Read", why: "check whose token it is" },
    ],
    push: [{ name: "repository: Read and Write", why: "add the webhook that starts a backup on push; you need admin rights on each repo" }],
    tips: [
      "Create it under Settings → Applications → Generate new token, and set the permissions above under Select permissions.",
      "These tokens don't expire. Delete it on the same page when you no longer need it.",
      "Backups on push also need the server to allow webhooks to Nimbus's address ([webhook] ALLOWED_HOST_LIST in its app.ini).",
    ],
    link: (s) => (s ? `${s}/user/settings/applications` : ""),
    linkText: "Open your Forgejo applications page",
    hint: "Your own server, or codeberg.org",
  },
}

export const ORDER: Provider[] = ["github", "gitlab", "gitea", "forgejo"]

export function ProviderIcon({ provider, className = "size-4 shrink-0 text-muted-foreground" }: { provider: Provider; className?: string }) {
  const I = PROVIDERS[provider].icon
  return <I aria-hidden className={className} />
}
