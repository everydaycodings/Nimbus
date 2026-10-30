"use server"

import { revalidatePath } from "next/cache"

import { saveSettings } from "@/lib/audit"
import { runChecks } from "@/lib/health"
import {
  DEFAULT_SLOW_MS,
  INTERVALS,
  SERVICES,
  type Service,
} from "@/lib/health-rules"
import { enqueue, scheduleHealth } from "@/lib/redis"
import { requireAdmin } from "@/lib/session"

export async function runHealthChecks() {
  await requireAdmin()
  await runChecks()
  revalidatePath("/admin", "layout")
}

// The worker runs it; the page refreshes itself and shows the result.
export async function runOrphanSweep() {
  await requireAdmin()
  await enqueue("orphan-sweep", {})
  revalidatePath("/admin", "layout")
}

export async function recheckService(service: string) {
  await requireAdmin()
  if (!SERVICES.includes(service as Service)) return
  await runChecks([service as Service])
  revalidatePath("/admin", "layout")
}

const whole = (form: FormData, field: string, min: number, max: number) => {
  const n = Math.round(Number(form.get(field)))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null
}

export async function setHealthSchedule(form: FormData) {
  await requireAdmin()
  const raw = Number(form.get("interval"))
  const minutes = INTERVALS.includes(raw as (typeof INTERVALS)[number])
    ? raw
    : null
  await saveSettings({
    healthIntervalMin: minutes,
    healthFailures: whole(form, "failures", 1, 10) ?? 2,
    healthRetentionDays: whole(form, "retention", 1, 365) ?? 30,
    updatedAt: new Date(),
  })
  await scheduleHealth(minutes)
  revalidatePath("/admin", "layout")
}

export async function setHealthServices(form: FormData) {
  await requireAdmin()
  const slow: Partial<Record<Service, number>> = {}
  for (const x of SERVICES) {
    const ms = String(form.get(`slow:${x}`) ?? "").trim()
    // Blank or the default isn't an override.
    if (ms && x in DEFAULT_SLOW_MS) {
      const n = whole(form, `slow:${x}`, 1, 60_000)
      if (n && n !== DEFAULT_SLOW_MS[x]) slow[x] = n
    }
  }
  await saveSettings({
    healthDisabled: SERVICES.filter((x) => form.get(`check:${x}`) !== "on"),
    healthSlowMs: slow,
    updatedAt: new Date(),
  })
  revalidatePath("/admin", "layout")
}
