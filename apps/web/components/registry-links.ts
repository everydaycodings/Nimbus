import type { Counts } from "@/components/registry-scan"

// Shared by server pages and client views, so not in a "use client" file.
export const VIEWS = [
  ["overview", "Overview"],
  ["packages", "Packages"],
  ["compare", "Compare"],
  ["base", "Base image"],
] as const
export type View = (typeof VIEWS)[number][0]

export const compareHref = (name: string, a: string, b: string) => `/registry/${name}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`

// "library/alpine" -> "alpine": how it's written in a FROM line.
export const baseName = (n: string) => n.replace(/^library\//, "")

// "1 high" or "2 critical and 1 high": what moving to the suggested base takes away.
export function fixSummary(from: Counts, to: Counts) {
  return (["critical", "high"] as const)
    .map((s) => ({ s, n: from[s] - to[s] }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.s}`)
    .join(" and ")
}

