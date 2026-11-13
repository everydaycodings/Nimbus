"use server"

import type { FaceAssign } from "@nimbus/shared/api"

import * as people from "@/lib/services/people"
import * as transcripts from "@/lib/services/transcripts"
import { requireMember } from "@/lib/session"

// The web's twin of /api/v1/people/*, /faces/*, /files/{id}/transcript and /account/faces.

export async function getPeople(hidden = false) {
  return people.listPeople(await requireMember(), hidden)
}

export async function renamePerson(id: string, name: string | null) {
  return people.updatePerson(await requireMember(), id, { name })
}

export async function hidePerson(id: string, hidden: boolean) {
  return people.updatePerson(await requireMember(), id, { hidden })
}

export async function setPersonMemories(id: string, memories: boolean) {
  return people.updatePerson(await requireMember(), id, { memories })
}

export async function mergePerson(id: string, intoId: string) {
  return people.mergePeople(await requireMember(), id, intoId)
}

export async function moveFaces(id: string, faceIds: string[], toId: string | null) {
  return people.moveFaces(await requireMember(), id, faceIds, toId)
}

export async function notPerson(id: string, faceIds: string[]) {
  return people.notPerson(await requireMember(), id, faceIds)
}

export async function getPersonFaces(id: string) {
  return people.personFaces(await requireMember(), id)
}

export async function setPersonCover(id: string, coverFaceId: string) {
  return people.updatePerson(await requireMember(), id, { coverFaceId })
}

export async function getSuggestions(id: string) {
  return people.suggestions(await requireMember(), id)
}

export async function answerSuggestion(faceId: string, accept: boolean) {
  return people.answerSuggestion(await requireMember(), faceId, accept)
}

export async function assignFace(faceId: string, to: FaceAssign) {
  return people.assignFace(await requireMember(), faceId, to)
}

export async function tagPhoto(nodeId: string, to: { personId?: string; name?: string }) {
  return people.tagPhoto(await requireMember(), nodeId, to)
}

export async function getFileFaces(nodeId: string) {
  return people.fileFaces(await requireMember(), nodeId)
}

// The faces of the given photos that belong to one person, for "Not X" and "Move to…" from the grid.
export async function personFaceIds(personId: string, nodeIds: string[]) {
  const me = await requireMember()
  const lists = await Promise.all(nodeIds.map((n) => people.fileFaces(me, n)))
  return lists.flat().filter((f) => f.personId === personId).map((f) => f.id)
}

export async function setFaceGrouping(on: boolean) {
  return people.setFacesOn(await requireMember(), on)
}

export async function getTranscript(id: string) {
  return (await transcripts.transcript(await requireMember(), id))?.res ?? null
}

export async function redoTranscript(id: string) {
  return transcripts.redoTranscript(await requireMember(), id)
}
