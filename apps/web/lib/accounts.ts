// Several accounts signed in on one browser. Better Auth's multi-session plugin
// keeps their sessions; these cookies only add what the account menu shows.
// No app imports: lib/auth.ts loads this, and the Better Auth CLI can't resolve them.

// Set while someone signs in to another account on top of the current one.
export const ADDING_COOKIE = "nimbus_adding"

// Who has signed in on this browser, so an account whose session ran out stays
// in the menu as "Sign in again". Display only; it grants nothing.
export const KNOWN_COOKIE = "nimbus_known"
export type Known = {
  id: string
  name: string
  email: string
  image: string | null
}

// Hard cap behind the admin's limit, for direct API calls.
export const MAX_SESSIONS = 10

export function parseKnown(raw: string | undefined): Known[] {
  try {
    const list = JSON.parse(raw ?? "[]")
    return Array.isArray(list)
      ? list.filter((k) => typeof k?.id === "string").slice(0, MAX_SESSIONS)
      : []
  } catch {
    return []
  }
}

export const KNOWN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  // Like Better Auth's own cookies: self-hosters on plain http still get them.
  secure: Boolean(process.env.BETTER_AUTH_URL?.startsWith("https://")),
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const

// localStorage: the account in use. Every app tab writes it on load, and the
// others reload when it changes, however the change happened.
export const ACTIVE_ACCOUNT = "nimbus:active-account"
// sessionStorage: the name to show in "Now using …" after the reload.
export const NOW_USING = "nimbus:now-using"

// A full page load rather than a client navigation, so nothing the last account
// left in memory (unlocked vault keys, uploads, cached pages) carries over.
export function reloadTo(path: string) {
  window.location.assign(path)
}
