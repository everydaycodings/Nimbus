import {
  ClockIcon,
  CloudIcon,
  FolderIcon,
  EnvelopeSimpleIcon,
  HourglassIcon,
  KeyIcon,
  LockIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SignOutIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { NavLink } from "@/components/nav-link"
import { SIDEBAR_COOKIE } from "@/components/nav-styles"
import { NavUser } from "@/components/nav-user"
import { StorageMeter } from "@/components/storage-meter"
import { PasswordForm } from "@/components/password-form"
import { ResendVerification } from "@/components/resend-verification"
import { NotificationBell, SharedBadge } from "@/components/notification-bell"
import { SearchPalette } from "@/components/search-palette"
import { SidebarShell } from "@/components/sidebar-shell"
import { TwoFactorSetup } from "@/components/two-factor"
import { NewMenu, UploadProvider } from "@/components/upload-provider"
import { VaultKeysProvider } from "@/components/vault-keys"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { db } from "@/lib/db"
import { notifications, user } from "@/lib/db/schema"
import { emailEnabled } from "@/lib/email"
import { getUsage } from "@/lib/quota"
import { getSession, hasPassword, isAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { signOut } from "./actions"

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" }

const FILE_LINKS = [
  { href: "/recent", label: "Recent", icon: ClockIcon },
  { href: "/starred", label: "Starred", icon: StarIcon },
  { href: "/shared", label: "Shared with me", icon: UsersIcon },
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
  wide,
}: {
  icon: typeof HourglassIcon
  title: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className={`w-full ${wide ? "max-w-lg" : "max-w-md"}`}>
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
  const admin = isAdmin(me.role)

  // Gates, in order: a temporary password, an unconfirmed email, approval, then
  // the admin's two-factor rule. Each one is a full screen with a way forward.
  if (me.passwordTemporary)
    return (
      <StatusScreen icon={KeyIcon} title="Choose your own password">
        <p>
          An admin set a temporary password for{" "}
          <span className="text-foreground">{me.email}</span>. Replace it with
          one only you know to continue.
        </p>
        <div className="pt-2 text-foreground">
          <PasswordForm
            currentLabel="Temporary password"
            submitLabel="Save password"
          />
        </div>
      </StatusScreen>
    )

  // Email confirmation only applies while email works, and two-factor replaces it.
  // Admins skip it so a broken email setup can't lock out the people who fix it.
  const [password, settings] = await Promise.all([
    hasPassword(me.id),
    getSettings(),
  ])
  if (
    !me.emailVerified &&
    !me.twoFactorEnabled &&
    !admin &&
    (await emailEnabled())
  )
    return (
      <StatusScreen icon={EnvelopeSimpleIcon} title="Confirm your email" wide>
        <p>
          We sent a link to <span className="text-foreground">{me.email}</span>.
          Open it to finish setting up your account.
        </p>
        <div className="flex flex-col gap-5 pt-2">
          <ResendVerification variant="default" label="Send the link again" />
          {password && (
            <div className="flex flex-col gap-3 border-t pt-5">
              <p>
                Prefer an authenticator app? Set up two-factor instead and skip
                the email.
              </p>
              <div className="text-foreground">
                <TwoFactorSetup startVariant="outline" />
              </div>
            </div>
          )}
        </div>
      </StatusScreen>
    )

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

  if (settings.require2fa && password && !me.twoFactorEnabled)
    return (
      <StatusScreen
        icon={ShieldIcon}
        title="Set up two-factor to continue"
        wide
      >
        <p>
          Your admin requires two-factor authentication on this Nimbus. After
          your password, you&apos;ll also enter a code from an authenticator app
          on your phone.
        </p>
        <div className="pt-2 text-foreground">
          <TwoFactorSetup autoStart />
        </div>
      </StatusScreen>
    )

  const pending = admin
    ? (
        await db
          .select({ n: count() })
          .from(user)
          .where(eq(user.status, "pending"))
      )[0].n
    : 0

  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1"
  const [counts] = await db
    .select({
      unread: sql<number>`count(*)::int`,
      shared: sql<number>`(count(*) filter (where ${notifications.kind} = 'shared'))::int`,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)))
  const [vaultPrefs] = await db
    .select({
      lockMinutes: user.vaultLockMinutes,
      vaults: sql<number>`(select count(*)::int from vaults where owner_id = ${me.id})`,
    })
    .from(user)
    .where(eq(user.id, me.id))
  const label =
    "transition-opacity group-data-[collapsed=true]/sidebar:opacity-0"

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-2">
      <div className="flex items-center gap-2 p-2 group-data-[collapsed=true]/sidebar:p-0">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent">
          <CloudIcon weight="fill" className="size-5 text-brand" />
        </span>
        <span
          className={`grid text-sm leading-tight whitespace-nowrap ${label}`}
        >
          <span className="font-semibold">Nimbus</span>
          <span className="text-xs text-muted-foreground">Self-hosted</span>
        </span>
      </div>
      <nav className="flex flex-col gap-4" aria-label="Main">
        <NewMenu />
        <div className="flex flex-col gap-0.5">
          <p
            className={`flex h-8 items-center px-2 text-xs font-medium whitespace-nowrap text-muted-foreground ${label}`}
          >
            Files
          </p>
          <NavLink
            href="/"
            match="/folders"
            icon={<FolderIcon />}
            label="My files"
          />
          {FILE_LINKS.map(({ href, label: name, icon: Icon }) => (
            <NavLink key={href} href={href} icon={<Icon />} label={name}>
              {href === "/shared" && <SharedBadge initial={counts} />}
            </NavLink>
          ))}
          {(settings.vaultsEnabled || vaultPrefs.vaults > 0) && (
            <NavLink href="/vault" icon={<LockIcon />} label="Vault" />
          )}
          <NavLink href="/trash" icon={<TrashIcon />} label="Trash" />
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
      <div className="mt-auto flex flex-col gap-3">
        <StorageMeter usage={await getUsage(me.id)} />
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
    <UploadProvider
      tusUrl={process.env.TUS_URL ?? ""}
      zipMode={process.env.VERCEL ? "client" : "server"}
    >
      <SidebarShell
        sidebar={sidebar}
        defaultCollapsed={collapsed}
        actions={
          <>
            <SearchPalette admin={admin} />
            <NotificationBell initial={counts} />
          </>
        }
      >
        <VaultKeysProvider minutes={vaultPrefs.lockMinutes}>
          {children}
        </VaultKeysProvider>
      </SidebarShell>
    </UploadProvider>
  )
}
