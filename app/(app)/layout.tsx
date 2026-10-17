import {
  ClockIcon,
  CloudIcon,
  FolderIcon,
  HourglassIcon,
  LockIcon,
  ShieldCheckIcon,
  SignOutIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { count, eq } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { NavLink } from "@/components/nav-link"
import { NAV_ITEM, NAV_LABEL, SIDEBAR_COOKIE } from "@/components/nav-styles"
import { NavUser } from "@/components/nav-user"
import { SidebarShell } from "@/components/sidebar-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { getSession, isAdmin } from "@/lib/session"
import { signOut } from "./actions"

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" }

// Sections that arrive with the file browser (Phase 4).
const UPCOMING = [
  { label: "Recent", icon: ClockIcon },
  { label: "Starred", icon: StarIcon },
  { label: "Shared with me", icon: UsersIcon },
  { label: "Vault", icon: LockIcon },
  { label: "Trash", icon: TrashIcon },
]

function SignOutButton() {
  return (
    <form action={signOut}>
      <Button variant="outline" type="submit">
        <SignOutIcon />
        Sign out
      </Button>
    </form>
  )
}

function StatusScreen({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof HourglassIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-4">
          <span className="grid size-10 place-items-center rounded-lg bg-muted">
            <Icon className="size-5 text-muted-foreground" />
          </span>
          <CardTitle className="text-xl text-balance">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          {children}
        </CardContent>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  )
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect("/sign-in")
  const me = session.user

  if (me.status === "pending")
    return (
      <StatusScreen icon={HourglassIcon} title="Waiting for approval">
        <p>
          Your account <span className="text-foreground">{me.email}</span> is
          set up. An admin of this Nimbus needs to approve it before you can
          store files.
        </p>
        <p>Check back later. This page updates once you&apos;re approved.</p>
      </StatusScreen>
    )

  if (me.status === "rejected")
    return (
      <StatusScreen icon={XCircleIcon} title="Your request was declined">
        <p>
          An admin of this Nimbus declined access for{" "}
          <span className="text-foreground">{me.email}</span>. If you think
          that&apos;s a mistake, contact the person who runs this instance.
        </p>
      </StatusScreen>
    )

  const admin = isAdmin(me.role)
  const pending = admin
    ? (
        await db
          .select({ n: count() })
          .from(user)
          .where(eq(user.status, "pending"))
      )[0].n
    : 0

  const collapsed =
    (await cookies()).get(SIDEBAR_COOKIE)?.value === "1"
  const label =
    "transition-opacity group-data-[collapsed=true]/sidebar:opacity-0"

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-2">
      <div className="flex items-center gap-2 p-2 group-data-[collapsed=true]/sidebar:p-0">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent">
          <CloudIcon weight="fill" className="size-5 text-brand" />
        </span>
        <span className={`grid text-sm leading-tight whitespace-nowrap ${label}`}>
          <span className="font-semibold">Nimbus</span>
          <span className="text-xs text-muted-foreground">Self-hosted</span>
        </span>
      </div>
      <nav className="flex flex-col gap-4" aria-label="Main">
        <div className="flex flex-col gap-0.5">
          <p
            className={`flex h-8 items-center px-2 text-xs font-medium whitespace-nowrap text-muted-foreground ${label}`}
          >
            Files
          </p>
          <NavLink href="/" icon={<FolderIcon />} label="My files" />
          {UPCOMING.map(({ label: name, icon: Icon }) => (
            <span
              key={name}
              aria-disabled
              title={`${name}: coming with the file browser`}
              className={`${NAV_ITEM} cursor-default text-sidebar-foreground/40`}
            >
              <Icon />
              <span className={NAV_LABEL}>{name}</span>
            </span>
          ))}
        </div>
        {admin && (
          <div className="flex flex-col gap-0.5">
            <NavLink href="/admin" icon={<ShieldCheckIcon />} label="Admin">
              {pending > 0 && (
                <Badge className="h-5 min-w-5 rounded-full px-1.5 tabular-nums group-data-[collapsed=true]/sidebar:absolute group-data-[collapsed=true]/sidebar:top-1 group-data-[collapsed=true]/sidebar:right-1 group-data-[collapsed=true]/sidebar:h-2 group-data-[collapsed=true]/sidebar:min-w-2 group-data-[collapsed=true]/sidebar:p-0 group-data-[collapsed=true]/sidebar:text-[0px]">
                  {pending}
                  <span className="sr-only"> waiting for approval</span>
                </Badge>
              )}
            </NavLink>
          </div>
        )}
      </nav>
      <div className="mt-auto">
        <NavUser
          name={me.name}
          email={me.email}
          image={me.image}
          role={ROLE_LABEL[me.role]}
        />
      </div>
    </div>
  )

  return (
    <SidebarShell sidebar={sidebar} defaultCollapsed={collapsed}>
      {children}
    </SidebarShell>
  )
}
