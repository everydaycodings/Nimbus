import { androidRelease } from "@/lib/android-release"

// Public: the APKs on offer, or null.
export async function GET() {
  return Response.json(await androidRelease(), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
