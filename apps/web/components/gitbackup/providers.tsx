import { GitBranchIcon, GithubLogoIcon, GitlabLogoIcon, GitForkIcon, type Icon } from "@phosphor-icons/react"

import type { Provider } from "@/lib/gitbackup/refs"

// What the connect form says per git host. Phosphor has no Gitea or Forgejo mark, so those get neutral git icons.
export const PROVIDERS: Record<Provider, { label: string; icon: Icon; placeholder: string; scopes: string[]; extra: string; link: (server: string) => string; linkText: string; hint: string }> = {
  github: {
    label: "GitHub",
    icon: GithubLogoIcon,
    placeholder: "ghp_…",
    scopes: ["repo", "read:org"],
    extra: "to see private and organization repos",
    link: () => "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Nimbus%20Git%20Backup",
    linkText: "Create one on GitHub",
    hint: "github.com or GitHub Enterprise",
  },
  gitlab: {
    label: "GitLab",
    icon: GitlabLogoIcon,
    placeholder: "glpat-…",
    scopes: ["read_api", "read_repository"],
    extra: "to list and clone your projects. Add api only if you want backups on push",
    link: (s) => `${s || "https://gitlab.com"}/-/user_settings/personal_access_tokens?name=Nimbus%20Git%20Backup&scopes=read_api,read_repository`,
    linkText: "Create one on GitLab",
    hint: "gitlab.com or self-hosted",
  },
  gitea: {
    label: "Gitea",
    icon: GitBranchIcon,
    placeholder: "Access token",
    scopes: ["read:repository", "read:organization", "read:user"],
    extra: "to list and clone your repos. Add write:repository only if you want backups on push",
    link: (s) => (s ? `${s}/user/settings/applications` : ""),
    linkText: "Open your Gitea applications page",
    hint: "Self-hosted",
  },
  forgejo: {
    label: "Forgejo",
    icon: GitForkIcon,
    placeholder: "Access token",
    scopes: ["read:repository", "read:organization", "read:user"],
    extra: "to list and clone your repos. Add write:repository only if you want backups on push",
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
