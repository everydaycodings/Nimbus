// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isAuthRoute = createRouteMatcher([
  "/auth/login(.*)",
  "/auth/register(.*)",
]);

const isPublicRoute = createRouteMatcher([
  "/auth/login(.*)",
  "/auth/register(.*)",
  "/api/webhooks(.*)",
  "/share/(.*)",
  "/api/share/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Logged-in user trying to visit auth pages → redirect to home
  if (isAuthRoute(req) && userId) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Public route → always allow through (logged in or not)
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // Protected route + not logged in → redirect to login
  if (!userId) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};