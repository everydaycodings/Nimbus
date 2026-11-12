import { withMember } from "@/lib/api"
import { restoreWindow } from "@/lib/services/point-restore"

// The earliest time a restore can go back to (`earliest`; null: no limit). Any id works.
export const GET = () => withMember(async () => Response.json(await restoreWindow()))
