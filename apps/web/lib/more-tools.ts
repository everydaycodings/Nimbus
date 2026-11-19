import { GitBranchIcon } from "@phosphor-icons/react/dist/ssr"
import type { Icon } from "@phosphor-icons/react"

import type { Settings } from "@/lib/signup"

// Tools on the More page. A tool shows only while its admin switch is on.
export const MORE_TOOLS: {
  id: string
  href: string
  name: string
  text: string
  icon: Icon
  enabled: (s: Settings) => boolean
}[] = [
  {
    id: "github-backup",
    href: "/more/github-backup",
    name: "Git Backup",
    text: "Back up your GitHub repos to S3 on a schedule",
    icon: GitBranchIcon,
    enabled: (s) => s.gitBackupEnabled,
  },
]

export const moreTools = (s: Settings) => MORE_TOOLS.filter((t) => t.enabled(s))
