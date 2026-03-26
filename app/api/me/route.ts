// app/api/me/route.ts
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .single()

  if (!data) return new Response("Not found", { status: 404 })
  return new Response("OK", { status: 200 })
}
