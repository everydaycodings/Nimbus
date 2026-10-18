import { SubmitButton } from "@/components/submit-button"
import type { user } from "@/lib/db/schema"
import type { VaultSummary } from "@/lib/vault"
import { setRole, setStatus } from "./actions"
import { MemberMenu } from "./member-menu"

// Approve, decline, role and recovery for one person, as on the list and their page.
export function MemberActions({
  me,
  p,
  fallback,
  vaults,
}: {
  me: { id: string; role: string }
  p: typeof user.$inferSelect
  fallback: number | null
  vaults: VaultSummary[]
}) {
  const locked = p.role === "owner" || p.id === me.id
  if (locked) return null
  // Mirrors recoverable() in actions.ts.
  const recoverable = p.role !== "admin" || me.role === "owner"
  return (
    <div className="flex items-center gap-2">
      {p.status !== "active" && (
        <form action={setStatus.bind(null, p.id, "active")}>
          <SubmitButton size="sm">Approve</SubmitButton>
        </form>
      )}
      {p.status !== "rejected" && (
        <form action={setStatus.bind(null, p.id, "rejected")}>
          <SubmitButton size="sm" variant="destructive">
            {p.status === "pending" ? "Decline" : "Remove access"}
          </SubmitButton>
        </form>
      )}
      {me.role === "owner" && p.status === "active" && (
        <form
          action={setRole.bind(
            null,
            p.id,
            p.role === "admin" ? "member" : "admin"
          )}
        >
          <SubmitButton size="sm" variant="outline">
            {p.role === "admin" ? "Make member" : "Make admin"}
          </SubmitButton>
        </form>
      )}
      {recoverable && p.status === "active" && (
        <MemberMenu
          id={p.id}
          name={p.name}
          twoFactor={Boolean(p.twoFactorEnabled)}
          quota={p.quotaBytes}
          fallback={fallback}
          vaults={vaults}
        />
      )}
    </div>
  )
}
