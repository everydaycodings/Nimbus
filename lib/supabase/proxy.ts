import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // This will refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith("/auth")
  const isPublicRoute = 
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/share") ||
    request.nextUrl.pathname.startsWith("/api/share") ||
    request.nextUrl.pathname.startsWith("/api/download-share") ||
    request.nextUrl.pathname.startsWith("/api/upload")

  if (!user && !isAuthRoute && !isPublicRoute) {
    // If not authenticated, redirect to login page (skip for auth/public routes)
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute && !request.nextUrl.pathname.startsWith("/auth/reset-password") && !request.nextUrl.pathname.startsWith("/auth/callback")) {
    // If authenticated, redirect away from auth routes to dashboard
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
