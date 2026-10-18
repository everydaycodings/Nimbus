import {
  ClockIcon,
  CloudIcon,
  FolderIcon,
  EnvelopeSimpleIcon,
  HourglassIcon,
  KeyIcon,
  LockIcon,
  ShieldIcon,
  ShieldCheckIcon,
  SignOutIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { and, count, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { AdminNav } from "@/components/admin-nav"
import { Search } from "@/components/admin-search"
import { NavLink } from "@/components/nav-link"
import { SIDEBAR_COOKIE } from "@/components/nav-styles"
import { NavUser } from "@/components/nav-user"
import { StorageMeter } from "@/components/storage-meter"
import { PasswordForm } from "@/components/password-form"
import { PasswordPolicyProvider } from "@/components/password-input"
import { ResendVerification } from "@/components/resend-verification"
import { NotificationBell, SharedBadge } from "@/components/notification-bell"
import { SidebarShell } from "@/components/sidebar-shell"
import { Toaster } from "@/components/toaster"
import { TwoFactorSetup } from "@/components/two-factor"
import { NewMenu, UploadProvider } from "@/components/upload-provider"
import { VaultKeysProvider } from "@/components/vault-keys"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { db } from "@/lib/db"
import { notifications, shares, user } from "@/lib/db/schema"
import { emailEnabled } from "@/lib/email"
import { healthAlarm } from "@/lib/health"
import { getUsage } from "@/lib/quota"
import { getSession, hasPassword, isAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { signOut } from "./actions"

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" }

const FILE_LINKS = [
  { href: "/recent", label: "Recent", icon: ClockIcon },
  { href: "/starred", label: "Starred", icon: StarIcon },
  { href: "/shared", label: "Shared files", icon: UsersIcon },
]

function Brand({
  icon: Icon,
  title,
  fade,
}: {
  icon: typeof CloudIcon
  title: string
  // Hides the text on the collapsed rail.
  fade: string
}) {
  return (
    <div className="flex items-center gap-2 p-2 group-data-[collapsed=true]/sidebar:p-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent">
        <Icon weight="fill" className="size-5 text-brand" />
      </span>
      <span className={`grid text-sm leading-tight whitespace-nowrap ${fade}`}>
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">Self-hosted</span>
      </span>
    </div>
  )
}

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
          <PasswordPolicyProvider policy={(await getSettings()).passwordPolicy}>
            <PasswordForm
              currentLabel="Temporary password"
              submitLabel="Save password"
            />
          </PasswordPolicyProvider>
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

  const navUser = (
    <NavUser
      name={me.name}
      email={me.email}
      image={me.image}
      role={ROLE_LABEL[me.role]}
      admin={admin}
      pending={pending}
    />
  )

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-2">
      <Brand icon={CloudIcon} title="Nimbus" fade={label} />
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
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <StorageMeter usage={await getUsage(me.id)} />
        {navUser}
      </div>
    </div>
  )

  // Admins get their own sidebar under /admin; SidebarShell picks it by path.
  const adminSidebar = admin && (
    <div className="flex h-full flex-col gap-4 p-2">
      <Brand icon={ShieldCheckIcon} title="Nimbus Admin" fade={label} />
      <AdminNav
        pending={pending}
        links={
          (
            await db
              .select({ n: count() })
              .from(shares)
              .where(
                and(
                  isNotNull(shares.token),
                  or(isNull(shares.expiresAt), gt(shares.expiresAt, sql`now()`))
                )
              )
          )[0].n
        }
        emailOff={!(await emailEnabled())}
        healthAlarm={await healthAlarm()}
      />
      <div className="mt-auto">{navUser}</div>
    </div>
  )

  return (
    <Toaster position={settings.toastPosition}>
      <UploadProvider
        tusUrl={process.env.TUS_URL ?? ""}
        zipMode={process.env.VERCEL ? "client" : "server"}
      >
        <SidebarShell
          sidebar={sidebar}
          adminSidebar={adminSidebar}
          defaultCollapsed={collapsed}
          actions={
            <>
              <Search admin={admin} />
              <NotificationBell initial={counts} />
            </>
          }
        >
          <VaultKeysProvider minutes={vaultPrefs.lockMinutes}>
            <PasswordPolicyProvider policy={settings.passwordPolicy}>
              {children}
            </PasswordPolicyProvider>
          </VaultKeysProvider>
        </SidebarShell>
      </UploadProvider>
    </Toaster>
  )
}
