import { desc, eq } from "drizzle-orm"

import { withMember } from "@/lib/api"
import { db } from "@/lib/db"
import { account, appPasswords, user } from "@/lib/db/schema"
import { channelPrefs } from "@/lib/notify"
import { prefKinds } from "@/lib/services/account"
import { getSettings } from "@/lib/signup"

// Everything the Account screen shows. Two-factor lives on Better Auth's own
// endpoints (see the README); `twoFactor` here says whether it's on.
export const GET = () =>
  withMember(async (me) => {
    const [linked, prefs, [row], apps, settings] = await Promise.all([
      db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, me.id)),
      channelPrefs(me.id),
      db
        .select({
          lock: user.vaultLockMinutes,
          webdavOff: user.webdavDisabled,
        })
        .from(user)
        .where(eq(user.id, me.id)),
      db
        .select()
        .from(appPasswords)
        .where(eq(appPasswords.userId, me.id))
        .orderBy(desc(appPasswords.createdAt)),
      getSettings(),
    ])
    const kinds = new Set<string>(prefKinds(me))
    return Response.json({
      profile: {
        id: me.id,
        name: me.name,
        email: me.email,
        image: me.image ?? null,
        emailVerified: me.emailVerified,
      },
      linkedProviders: linked.map((l) => l.providerId),
      hasPassword: linked.some((l) => l.providerId === "credential"),
      twoFactor: Boolean(me.twoFactorEnabled),
      notificationPrefs: prefs.filter((p) => kinds.has(p.kind)),
      vaultLockMinutes: row?.lock ?? 15,
      // App passwords are for WebDAV; the section is hidden when it's off.
      appPasswordsEnabled: settings.webdav && !row?.webdavOff,
      appPasswords: apps.map((a) => ({
        id: a.id,
        name: a.name,
        scope: a.scope,
        lastFour: a.lastFour,
        createdAt: a.createdAt.toISOString(),
        lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
        lastIp: a.lastIp,
      })),
    })
  })
