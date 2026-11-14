"use server"

import { revalidatePath } from "next/cache"

import * as svc from "@/lib/registry/manage"
import { requireMember } from "@/lib/session"

const NOT_ON = { error: "The registry isn't available for your account right now." }

// Everything past claiming a name needs a working registry and a claimed name.
async function member() {
  const me = await requireMember()
  return (await svc.registryState(me.id)) === "ready" ? me : null
}

const done = <T extends { error?: string }>(r: T) => {
  if (!r.error) revalidatePath("/registry", "layout")
  return r
}

export async function claimName(name: string) {
  const me = await requireMember()
  const s = await svc.registryState(me.id)
  if (s !== "unclaimed") return { error: "You can't claim a name right now." }
  return done(await svc.claimName(me.id, name))
}

export async function createOrg(name: string, displayName: string) {
  const me = await member()
  return me ? done(await svc.createOrg(me.id, name, displayName)) : NOT_ON
}
export async function renameOrg(id: string, displayName: string) {
  const me = await member()
  return me ? done(await svc.renameOrg(me.id, id, displayName)) : NOT_ON
}
export async function deleteOrg(id: string) {
  const me = await member()
  return me ? done(await svc.deleteOrg(me.id, id)) : NOT_ON
}
export async function orgMembers(id: string) {
  const me = await member()
  return me ? svc.orgMembers(me.id, id) : []
}
export async function addOrgMember(id: string, email: string, role: string) {
  const me = await member()
  return me ? done(await svc.addOrgMember(me.id, id, email, role)) : NOT_ON
}
export async function setOrgRole(id: string, userId: string, role: string) {
  const me = await member()
  return me ? done(await svc.setOrgRole(me.id, id, userId, role)) : NOT_ON
}
export async function removeOrgMember(id: string, userId: string) {
  const me = await member()
  return me ? done(await svc.removeOrgMember(me.id, id, userId)) : NOT_ON
}

export async function setRepoPublic(name: string, isPublic: boolean) {
  const me = await member()
  return me ? done(await svc.setRepoPublic(me.id, name, isPublic)) : NOT_ON
}
export async function setImmutable(name: string, pattern: string) {
  const me = await member()
  return me ? done(await svc.setImmutable(me.id, name, pattern)) : NOT_ON
}
export async function deleteRepo(name: string) {
  const me = await member()
  return me ? done(await svc.deleteRepo(me.id, name)) : NOT_ON
}
export async function deleteTag(name: string, tag: string) {
  const me = await member()
  return me ? done(await svc.deleteTag(me.id, name, tag)) : NOT_ON
}

export async function createToken(o: svc.NewToken): ReturnType<typeof svc.createToken> {
  const me = await member()
  return me ? done(await svc.createToken(me.id, o)) : NOT_ON
}
export async function revokeToken(id: string) {
  const me = await requireMember()
  return done(await svc.revokeToken(me.id, id))
}

export async function searchRepos(q: string) {
  return svc.searchRepos((await requireMember()).id, q)
}
