// The account's saved signature and initials (PUT /api/v1/signatures), with a copy on the phone so they can be placed offline.
import type { SignatureKind, SignaturesResponse } from "@nimbus/shared/api"
import { File, Paths } from "expo-file-system"

import { safeAccount } from "./offline-rules"

const none: SignaturesResponse = { signature: null, initials: null }
const copy = (account: string) => new File(Paths.document, `signatures-${safeAccount(account)}.json`)

export function cachedSignatures(account: string): SignaturesResponse {
  try {
    const f = copy(account)
    return f.exists ? { ...none, ...JSON.parse(f.textSync()) } : none
  } catch {
    return none
  }
}

export function cacheSignatures(account: string, s: SignaturesResponse) {
  try {
    const f = copy(account)
    f.create({ overwrite: true })
    f.write(JSON.stringify(s))
  } catch {}
}

export const keptBody = (kind: SignatureKind, png: string) => JSON.stringify({ kind, png })
