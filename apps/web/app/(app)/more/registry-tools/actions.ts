"use server"

import { revalidatePath } from "next/cache"

import * as tools from "@/lib/registry/tools"
import { saveTokenToSecret as saveSecret } from "@/lib/registry/secrets-pull"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The signed-in member, only while an admin has Registry tools (and the registry) on.
async function member() {
  const me = await requireMember()
  const s = await getSettings()
  if (!s.registryToolsEnabled || !s.registry) throw new Error("Registry tools are turned off on this server.")
  return me
}

// The page shows the message instead of crashing.
async function safe<T extends object>(f: () => Promise<T>): Promise<T | { error: string }> {
  try {
    const r = await f()
    if (!("error" in r && r.error)) revalidatePath("/more/registry-tools", "layout")
    return r
  } catch (e) {
    return { error: (e as Error).message || "Something went wrong. Try again." }
  }
}

export async function dryRun(input: tools.RuleInput) {
  const me = await member()
  return safe(() => tools.dryRun(me.id, input))
}
export async function saveRule(id: string | null, input: tools.RuleInput) {
  const me = await member()
  return safe(() => tools.saveRule(me.id, id, input))
}
export async function deleteRule(id: string) {
  const me = await member()
  return safe(() => tools.deleteRule(me.id, id))
}
export async function setRuleEnabled(id: string, enabled: boolean) {
  const me = await member()
  return safe(() => tools.setRuleEnabled(me.id, id, enabled))
}
export async function runRule(id: string) {
  const me = await member()
  return safe(() => tools.runRuleNow(me.id, id))
}

export async function saveMirror(id: string | null, input: tools.MirrorInput) {
  const me = await member()
  return safe(() => tools.saveMirror(me.id, id, input))
}
export async function deleteMirror(id: string) {
  const me = await member()
  return safe(() => tools.deleteMirror(me.id, id))
}
export async function setMirrorEnabled(id: string, enabled: boolean) {
  const me = await member()
  return safe(() => tools.setMirrorEnabled(me.id, id, enabled))
}
export async function runMirror(id: string) {
  const me = await member()
  return safe(() => tools.runMirrorNow(me.id, id))
}

// "Keep a copy in Secrets" after saving an upstream login; the member's own Secrets rights apply.
export async function saveLoginToSecret(o: { token: string; name: string; projectId: string; envId: string }) {
  const me = await member()
  return saveSecret(me.id, { token: String(o.token), name: String(o.name), projectId: String(o.projectId), envId: String(o.envId), what: "registry mirror login" })
}
