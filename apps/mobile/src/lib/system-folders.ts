import type { SystemKind } from "@nimbus/shared/api"

// Folders Nimbus made by itself. The web has the same labels and warnings.
export type SystemAction = "rename" | "move" | "delete"
export type WithSystem = { system?: SystemKind }

const INFO: Record<SystemKind, { label: string; name: string; does: string }> = {
  camera: { label: "Photo backup", name: "Camera", does: "Photo backup puts new photos in Camera." },
  phone_backup: { label: "Contacts and calendar", name: "Phone backup", does: "Phone backup keeps your contacts and calendar in Phone backup." },
  documents: { label: "Documents", name: "Documents", does: "Documents files new scans and uploads in Documents, by year." },
  partner: { label: "Partner photos", name: "this folder", does: "Partner sharing saves your partner's photos here." },
}

export const systemLabel = (kind: SystemKind) => `Auto · ${INFO[kind].label}`

const THEN: Record<SystemAction, (name: string) => string> = {
  rename: (n) => `If you rename it, the next backup makes a new ${n} folder.`,
  move: (n) => `If you move it, the next backup makes a new ${n} folder.`,
  delete: (n) => `If you delete it, the next backup makes a new ${n} folder.`,
}

export function systemWarning(kind: SystemKind, action: SystemAction) {
  const { does, name } = INFO[kind]
  if (kind === "partner") {
    const then = { rename: "If you rename it", move: "If you move it", delete: "If you delete it" }[action]
    return `${does} ${then}, the next saved photos go in a new folder.`
  }
  return `${does} ${THEN[action](name)}`
}

// The first system kind among the items, if any (a warning covers the selection once).
export const systemIn = (items: WithSystem[]) => items.find((i) => i.system)?.system

// System folders first, the rest keep their order.
export function systemFirst<T extends WithSystem>(items: T[]): T[] {
  return [...items.filter((i) => i.system), ...items.filter((i) => !i.system)]
}
