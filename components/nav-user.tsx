"use client"

import { Menu } from "@base-ui/react/menu"
import { CaretUpDownIcon, SignOutIcon } from "@phosphor-icons/react"

import { signOut } from "@/app/(app)/actions"
import { useSidebar } from "@/components/sidebar-shell"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/user-avatar"

type Props = { name: string; email: string; image?: string | null; role: string }

function Identity({ name, email, image }: Omit<Props, "role">) {
  return (
    <>
      <UserAvatar name={name} image={image} />
      <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      </span>
    </>
  )
}

// Account section in the sidebar footer: who you are, your role, sign out.
export function NavUser({ role, ...user }: Props) {
  const { collapsed } = useSidebar()
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={collapsed ? `Account: ${user.name}` : undefined}
        className="flex w-full items-center gap-2 rounded-md p-2 outline-none group-data-[collapsed=true]/sidebar:p-0 [&>span:not(:first-child)]:group-data-[collapsed=true]/sidebar:hidden [&>svg]:group-data-[collapsed=true]/sidebar:hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-popup-open:bg-sidebar-accent"
      >
        <Identity {...user} />
        <CaretUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "start"}
          sideOffset={collapsed ? 12 : 6}
        >
          <Menu.Popup className="w-60 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="flex items-center gap-2 px-1 py-1.5">
              <Identity {...user} />
              <Badge variant="outline">{role}</Badge>
            </div>
            <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
            <Menu.Item
              onClick={() => signOut()}
              className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"
            >
              <SignOutIcon />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
