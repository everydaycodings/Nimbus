// Tags every audit row written while a /api/v1/secrets request runs with its
// project, so the project's Audit tab can find them. Set by guard.ts.
import { AsyncLocalStorage } from "node:async_hooks"

export const auditScope = new AsyncLocalStorage<{ projectId: string; env?: string }>()
