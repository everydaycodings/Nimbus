import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Forward the user to the intended destination or the dashboard
      return NextResponse.redirect(`${origin}${next}`)
    } else {
      console.error("Auth callback error:", error)
    }
  }

  // fallback to login page on error
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
}
