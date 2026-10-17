"use client"

import { Tooltip } from "@base-ui/react/tooltip"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { NAV_ITEM, NAV_LABEL } from "@/components/nav-styles"
import { useSidebar } from "@/components/sidebar-shell"
import { cn } from "@/lib/utils"

export function NavLink({
  href,
  icon,
  label,
  match,
  children,
}: {
  href: string
  // Another path prefix this link owns, like /folders for My files.
  match?: string
  icon: React.ReactNode
  label: string
  children?: React.ReactNode
}) {
  const path = usePathname()
  const { collapsed } = useSidebar()
  // Sections own their sub-pages: /admin stays active on /admin/settings.
  const active =
    path === href ||
    path.startsWith(`${href}/`) ||
    Boolean(match && path.startsWith(match))

  return (
    <Tooltip.Root disabled={!collapsed}>
      <Tooltip.Trigger
        render={
          <Link
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              NAV_ITEM,
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground"
            )}
          />
        }
      >
        {icon}
        <span className={NAV_LABEL}>{label}</span>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={8}>
          <Tooltip.Popup className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-md">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
