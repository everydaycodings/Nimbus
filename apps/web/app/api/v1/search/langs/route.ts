import { withMember } from "@/lib/api"
import * as svc from "@/lib/services/search"

// Tesseract language codes for reading text out of images, e.g. "eng+deu".
export const GET = () =>
  withMember(async () => Response.json({ langs: await svc.ocrLangs() }))
