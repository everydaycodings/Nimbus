"use server"

import { refresh } from "next/cache"

import { UUID, listFolder } from "@/lib/files"
import * as svc from "@/lib/services/transfers"
import { requireMember } from "@/lib/session"

export async function createTransfer(o: svc.NewTransfer) {
  return svc.createTransfer(await requireMember(), o)
}

export async function addTransferFileToken(
  id: string,
  name: string,
  size: number
) {
  return svc.addFileToken(await requireMember(), id, name, size)
}

export async function finaliseTransfer(id: string) {
  const r = await svc.finaliseTransfer(await requireMember(), id)
  if (!r.error) refresh()
  return { error: r.error, linkToken: r.transfer?.linkToken ?? null }
}

export async function revokeTransfer(id: string) {
  const r = await svc.revokeTransfer(await requireMember(), id)
  if (!r.error) refresh()
  return r
}

export async function getTransferDetails(id: string) {
  return svc.getTransfer(await requireMember(), id)
}

// Throws the half-made transfer away (a device upload failed and they gave up).
export async function discardTransfer(id: string) {
  return svc.revokeTransfer(await requireMember(), id)
}

// My files and folders in a folder (root without one), for the picker.
export async function pickItems(parentId: string | null) {
  const me = await requireMember()
  const items = await listFolder(
    me.id,
    me.id,
    parentId && UUID.test(parentId) ? parentId : null
  )
  return items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, size: i.size }))
}

// What the dialog needs when opened from another page.
export async function transferSetup() {
  await requireMember()
  return {
    options: await svc.transferOptions(),
    tusUrl: process.env.TUS_URL ?? "",
  }
}
