import { withMember } from "@/lib/api"
import { PRESETS } from "@/lib/avatars"

// The preset pictures (paths on this server), the photo kept from sign-up if
// there is one, and the current picture. Uploaded pictures live at /api/avatar/<key>.
export const GET = () =>
  withMember(async (me) =>
    Response.json({
      presets: PRESETS,
      provider: me.providerImage ?? null,
      current: me.image ?? null,
    })
  )
