"use server"

import type {
  AlbumPatch,
  AlbumSharePatch,
  NewMemoryHide,
  PartnerInvite,
  PartnerPatch,
} from "@nimbus/shared/api"

import * as albums from "@/lib/services/albums"
import * as partners from "@/lib/services/partners"
import * as photos from "@/lib/services/photos"
import { requireMember } from "@/lib/session"

// The web's twin of /api/v1/photos/*, /albums/* and /partner (the same services).

export async function getMemories(date?: string) {
  return photos.memories(await requireMember(), date)
}

export async function getHides() {
  return photos.listHides(await requireMember())
}

export async function hideFromMemories(input: NewMemoryHide) {
  return photos.addHide(await requireMember(), input)
}

export async function showInMemories(id: string) {
  return photos.removeHide(await requireMember(), id)
}

export async function getPlaces(bbox?: string) {
  return photos.places(await requireMember(), photos.parseBbox(bbox))
}

export async function getPlaceItems(bbox: string) {
  return photos.placeItems(await requireMember(), photos.parseBbox(bbox))
}

export async function getSmart(group: string, limit = 500, cursor?: string) {
  return photos.smart(await requireMember(), group, limit, cursor)
}

export async function getAlbums() {
  return { albums: await albums.listAlbums(await requireMember()) }
}

export async function getAlbum(id: string) {
  return albums.getAlbum(await requireMember(), id)
}

export async function createAlbum(name: string, nodeIds?: string[]) {
  return albums.createAlbum(await requireMember(), { name, nodeIds })
}

export async function updateAlbum(id: string, patch: AlbumPatch) {
  return albums.updateAlbum(await requireMember(), id, patch)
}

export async function deleteAlbum(id: string) {
  return albums.deleteAlbum(await requireMember(), id)
}

export async function addToAlbum(id: string, nodeIds: string[]) {
  return albums.addItems(await requireMember(), id, nodeIds)
}

export async function removeFromAlbum(id: string, nodeIds: string[]) {
  return albums.removeItems(await requireMember(), id, nodeIds)
}

export async function getAlbumShares(id: string) {
  return albums.listShares(await requireMember(), id)
}

export async function shareAlbum(id: string, userId: string, role: "viewer" | "contributor") {
  return albums.shareWith(await requireMember(), id, userId, role)
}

export async function updateAlbumShare(id: string, shareId: string, patch: AlbumSharePatch) {
  return albums.updateShare(await requireMember(), id, shareId, patch)
}

export async function removeAlbumShare(id: string, shareId: string) {
  return albums.removeShare(await requireMember(), id, shareId)
}

export async function createAlbumLink(id: string, opts: { name?: string; password?: string } = {}) {
  return albums.createLink(await requireMember(), id, opts)
}

export async function getPartner() {
  return partners.getPartners(await requireMember())
}

export async function invitePartner(input: PartnerInvite) {
  return partners.invite(await requireMember(), input)
}

export async function updatePartner(patch: PartnerPatch) {
  return partners.updatePartner(await requireMember(), patch)
}

export async function savePartnerPhotos(nodeIds: string[]) {
  return partners.saveCopy(await requireMember(), nodeIds)
}
