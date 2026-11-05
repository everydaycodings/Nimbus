import { withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

// Collabora's viewer for an office file: { office: { action, token } }, where
// the app POSTs `access_token=token` into a WebView at `action`. { office: null }
// when Collabora isn't set up or doesn't open this file; use the built-in viewers.
export const GET = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) =>
    Response.json({
      office: await svc.officeFrame(
        me,
        (await params).id,
        new URL(req.url).searchParams.get("v")
      ),
    })
  )
