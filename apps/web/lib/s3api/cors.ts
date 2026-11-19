// Which CORS rule answers a browser request, and the headers it adds. Pure.
import type { CorsRule } from "./bucket-config.ts"

// The first rule that allows this origin and method, and for a preflight every header it asks for.
export function matchRule(rules: CorsRule[], origin: string, method: string, asked: string[] = []) {
  const want = asked.map((h) => h.trim().toLowerCase()).filter(Boolean)
  return rules.find(
    (r) =>
      (r.origins.includes("*") || r.origins.includes(origin)) &&
      (r.methods as string[]).includes(method.toUpperCase()) &&
      (r.headers.includes("*") || want.every((h) => r.headers.some((x) => x.toLowerCase() === h)))
  )
}

const allowed = (r: CorsRule, origin: string) => (r.origins.includes("*") ? "*" : origin)

export function preflightHeaders(r: CorsRule, origin: string, asked: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowed(r, origin),
    "Access-Control-Allow-Methods": r.methods.join(", "),
    ...(asked && { "Access-Control-Allow-Headers": asked }),
    ...(r.maxAgeSeconds && { "Access-Control-Max-Age": String(r.maxAgeSeconds) }),
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  }
}

export function actualHeaders(r: CorsRule, origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowed(r, origin),
    ...(r.expose.length && { "Access-Control-Expose-Headers": r.expose.join(", ") }),
    Vary: "Origin",
  }
}
