// Pure rules for Registry Cleanup & Mirror. Relative-import safe, so node --test can load it.
import { matchPattern, validTag } from "./rules.ts"

export const MIRROR_CAP_MAX = 50
export const MIN_INTERVAL = 15

const HUB = /^(docker\.io|index\.docker\.io|registry-1\.docker\.io)$/

// "alpine", "bitnami/redis", "docker.io/library/alpine", "ghcr.io/org/app", "localhost:5000/x", "http://host:5000/x".
// A first part with a dot or a colon (or "localhost") is a host; anything else is Docker Hub, where single names live in library/.
export function parseUpstream(raw: string): { url: string; host: string; path: string } | { error: string } {
  let ref = raw.trim()
  let scheme = "https"
  const s = /^(https?):\/\//i.exec(ref)
  if (s) {
    scheme = s[1].toLowerCase()
    ref = ref.slice(s[0].length)
  }
  ref = ref.replace(/\/+$/, "")
  if (!ref || /\s/.test(ref)) return { error: "Enter the image to mirror, like alpine or ghcr.io/org/app." }
  if (ref.includes("@") || ref.split("/").pop()!.includes(":"))
    return { error: "Leave the tag out of the image name. Put tags in the Tags field." }
  const [first, ...rest] = ref.split("/")
  const isHost = rest.length > 0 && (/[.:]/.test(first) || first === "localhost")
  const host = isHost ? first : "registry-1.docker.io"
  let path = (isHost ? rest : [first, ...rest]).join("/")
  if (!path) return { error: "Enter the image path after the registry host." }
  if (!/^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*)*$/.test(path))
    return { error: "That image name has characters a registry doesn't allow." }
  const hub = HUB.test(host.replace(/:\d+$/, ""))
  if (hub && !path.includes("/")) path = `library/${path}`
  const real = hub ? "registry-1.docker.io" : host
  return { url: `${hub ? "https" : scheme}://${real}`, host: real, path }
}

// "3.20" before "3.9", "v1.10" before "v1.9": numbers inside names compare as numbers.
export const newestFirst = (a: string, b: string) => b.localeCompare(a, "en", { numeric: true })

export const isGlob = (spec: string) => /[*?]/.test(spec)

// A tag list or glob(s), comma separated: the names to mirror out of `upstream` (the upstream's tag list; only
// read when the spec has a glob), newest first, at most `cap`.
// ponytail: "newest" is version order of the names, the registry API has no push dates; a tag list is taken as typed.
export function pickTags(spec: string, upstream: string[], cap: number): string[] {
  const parts = spec.split(",").map((p) => p.trim()).filter(Boolean)
  const out = new Set<string>()
  for (const p of parts.filter((p) => !isGlob(p))) if (validTag(p)) out.add(p)
  const globs = parts.filter(isGlob).join(",")
  if (globs) for (const t of [...upstream].filter((t) => matchPattern(globs, t)).sort(newestFirst)) out.add(t)
  return [...out].slice(0, cap)
}

export function validRegex(src: string): string | null {
  if (src.length > 100) return "Keep the pattern under 100 characters."
  try {
    new RegExp(src)
    return null
  } catch {
    return "That isn't a valid regular expression."
  }
}
