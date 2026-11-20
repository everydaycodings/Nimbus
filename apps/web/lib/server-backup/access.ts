import { isAdmin } from "@/lib/session"
import type { Settings } from "@/lib/signup"

// On for everyone, or for admins only when an admin turned members off.
export const allowed = (s: Settings, role: Parameters<typeof isAdmin>[0]) => s.serverBackupEnabled && (s.serverBackupMembers || isAdmin(role))
