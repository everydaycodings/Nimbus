import * as svc from "@/lib/services/documents"

// The Documents strip: how many need review, and what expires soon.
export const GET = () => svc.withDocs(async (me) => Response.json(await svc.summary(me)))
