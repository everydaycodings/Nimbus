// One door to the host modules: picks github.ts, gitlab.ts or gitea.ts (Forgejo too) by the connection's provider.
import "server-only"

import * as github from "./github.ts"
import * as gitea from "./gitea.ts"
import * as gitlab from "./gitlab.ts"
import type { Cfg, RepoList, Who } from "./host.ts"
import type { Provider } from "./refs.ts"

export type HostCfg = Cfg & { provider: Provider }
export const LABEL: Record<Provider, string> = { github: "GitHub", gitlab: "GitLab", gitea: "Gitea", forgejo: "Forgejo" }

const giteaLike = (p: "gitea" | "forgejo") => ({ whoami: gitea.whoami(LABEL[p]), repoList: gitea.repoList(LABEL[p]), setHook: (c: Cfg, ...a: [string, string, string, boolean]) => gitea.setHook(p, c, ...a) })
const MODULES = {
  github: { whoami: github.whoami, repoList: github.repoList, setHook: github.setHook },
  gitlab: { whoami: gitlab.whoami, repoList: gitlab.repoList, setHook: gitlab.setHook },
  gitea: giteaLike("gitea"),
  forgejo: giteaLike("forgejo"),
}

export const whoami = (c: HostCfg): Promise<Who> => MODULES[c.provider].whoami(c)
export const repoList = (key: string, c: HostCfg, refresh = false): Promise<RepoList> => MODULES[c.provider].repoList(key, c, refresh)
// full: "owner/name" (GitLab: "group/sub/name"). One repo's push hook, on or off.
export const setHook = (c: HostCfg, full: string, url: string, secret: string, on: boolean) => MODULES[c.provider].setHook(c, full, url, secret, on)
