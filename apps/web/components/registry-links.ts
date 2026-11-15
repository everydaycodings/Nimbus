// Shared by server pages and client views, so not in a "use client" file.
export const VIEWS = [
  ["overview", "Overview"],
  ["packages", "Packages"],
  ["compare", "Compare"],
  ["base", "Base image"],
] as const
export type View = (typeof VIEWS)[number][0]

export const compareHref = (name: string, a: string, b: string) => `/registry/${name}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
