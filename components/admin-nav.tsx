"use client"

import { ArrowLeftIcon, WarningIcon } from "@phosphor-icons/react"

import { ADMIN_GROUPS } from "@/components/admin-pages"
import { NavLink } from "@/components/nav-link"
import { Badge } from "@/components/ui/badge"

const LABEL =
  "flex h-8 items-center px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-opacity group-data-[collapsed=true]/sidebar:opacity-0"

// Same shape as the Shared files badge: a count, or a dot on the collapsed rail.
const COUNT =
  "h-5 min-w-5 rounded-full px-1.5 tabular-nums group-data-[collapsed=true]/sidebar:absolute group-data-[collapsed=true]/sidebar:top-1 group-data-[collapsed=true]/sidebar:right-1 group-data-[collapsed=true]/sidebar:h-2 group-data-[collapsed=true]/sidebar:min-w-2 group-data-[collapsed=true]/sidebar:p-0 group-data-[collapsed=true]/sidebar:text-[0px]"

export function AdminNav({
  pending,
  links,
  emailOff,
}: {
  pending: number
  links: number
  emailOff: boolean
}) {
  const badge: Record<string, React.ReactNode> = {
    "/admin/approvals": pending > 0 && (
      <Badge className={COUNT}>
        {pending}
        <span className="sr-only"> waiting</span>
      </Badge>
    ),
    "/admin/sharing/links": links > 0 && (
      <Badge variant="secondary" className={COUNT}>
        {links}
        <span className="sr-only"> active</span>
      </Badge>
    ),
    "/admin/system/email": emailOff && (
      <span
        title="Email is off"
        className="text-muted-foreground group-data-[collapsed=true]/sidebar:absolute group-data-[collapsed=true]/sidebar:top-0.5 group-data-[collapsed=true]/sidebar:right-0.5 [&_svg]:size-3.5!"
      >
        <WarningIcon weight="fill" />
        <span className="sr-only">Email is off</span>
      </span>
    ),
  }

  return (
    <nav
      className="-mx-2 flex min-h-0 flex-col gap-3 overflow-y-auto px-2 [scrollbar-width:thin]"
      aria-label="Admin"
    >
      <NavLink href="/" icon={<ArrowLeftIcon />} label="Back to Nimbus" />
      {ADMIN_GROUPS.map((g) => (
        <div key={g.title || "top"} className="flex flex-col gap-0.5">
          {g.title && <p className={LABEL}>{g.title}</p>}
          {g.pages.map(({ href, label, icon: Icon }) => (
            <NavLink
              key={href}
              href={href}
              exact={href === "/admin"}
              icon={<Icon />}
              label={label}
            >
              {badge[href]}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}
