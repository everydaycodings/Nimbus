// Pull counts for the repository page.
import "server-only"

import { and, eq, gte, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryPullsDaily } from "@/lib/db/schema"

import { fillDays } from "./extras-rules.ts"

const since = (days: number) => new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)

// One entry per day, oldest first, zeros for quiet days (days in UTC, like the counter).
export async function pullStats(repoId: string, days = 30): Promise<{ day: string; count: number }[]> {
  const rows = await db
    .select({ day: registryPullsDaily.day, count: sql<number>`sum(${registryPullsDaily.count})::int` })
    .from(registryPullsDaily)
    .where(and(eq(registryPullsDaily.repoId, repoId), gte(registryPullsDaily.day, since(days))))
    .groupBy(registryPullsDaily.day)
  return fillDays(rows, days, new Date().toISOString().slice(0, 10))
}

// Pulls per tag over the last 30 days.
export async function tagPulls(repoId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ tag: registryPullsDaily.tag, count: sql<number>`sum(${registryPullsDaily.count})::int` })
    .from(registryPullsDaily)
    .where(and(eq(registryPullsDaily.repoId, repoId), gte(registryPullsDaily.day, since(30))))
    .groupBy(registryPullsDaily.tag)
  return Object.fromEntries(rows.map((r) => [r.tag, r.count]))
}
