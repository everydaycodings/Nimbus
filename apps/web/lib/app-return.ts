// The Android app's OAuth return. The browser must not carry the session into
// nimbus://, which any installed app can claim, so the callback's redirect holds
// a one-time code instead. The app trades the code for the session token once.
// Rows live in Better Auth's verification table; only the code's hash is stored.
// Relative imports: lib/auth.ts loads this, and the Better Auth CLI can't resolve `@/`.
import { randomBytes, randomUUID } from "node:crypto"

import { and, eq, gt } from "drizzle-orm"

import { db } from "./db"
import { verification } from "./db/schema"
import { hashSecret } from "./device-link-rules"

const TTL_MS = 60_000
const identifier = (code: string) => `app-return-${hashSecret(code)}`

export async function stashSession(token: string) {
  const code = randomBytes(32).toString("base64url")
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: identifier(code),
    value: token,
    expiresAt: new Date(Date.now() + TTL_MS),
  })
  return code
}

// The delete only matches an unused, unexpired row, so a code works once.
export async function redeemSession(code: string) {
  const [row] = await db
    .delete(verification)
    .where(
      and(
        eq(verification.identifier, identifier(code)),
        gt(verification.expiresAt, new Date())
      )
    )
    .returning({ value: verification.value })
  return row?.value ?? null
}
