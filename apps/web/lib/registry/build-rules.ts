// Pure rules for automated image builds: tag templates, branch/tag rule matching, rule validation,
// presets and the buildctl command line. Relative-import safe (no `@/`, no server-only), so the build
// runner (scripts/registry-build.ts) and node --test load it too.
import { matchPattern, validTag } from "./rules.ts"

// Where builds keep their layer cache. Not an image: hidden from tag lists, never scanned or cleaned up.
export const BUILD_CACHE_TAG = "buildcache"

export type TagTemplate = string

export type RuleInput = {
  sourceType: "branch" | "tag"
  pattern: string
  tags: string[]
  dockerfile: string
  context: string
  buildArgs: { key: string; value: string }[]
  secretRefs: { id: string; projectId: string; env: string; key: string }[]
  platforms: string[]
  failOnCritical: boolean
  schedule: string | null
  enabled: boolean
}

export const PLATFORMS = ["linux/amd64", "linux/arm64", "linux/arm/v7", "linux/386", "linux/ppc64le", "linux/s390x", "linux/riscv64"]

export const PRESETS: { id: string; label: string; rule: Pick<RuleInput, "sourceType" | "pattern" | "tags"> }[] = [
  { id: "main", label: "Branch main → latest + sha", rule: { sourceType: "branch", pattern: "main", tags: ["latest", "{sha}"] } },
  { id: "any-branch", label: "Every branch → branch name", rule: { sourceType: "branch", pattern: "*", tags: ["{branch}"] } },
  { id: "semver", label: "Semver tags → version, major.minor, major", rule: { sourceType: "tag", pattern: "re:^v?\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$", tags: ["{version}", "{major}.{minor}", "{major}"] } },
]

// ---- tag templates --------------------------------------------------------------

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemver(tag: string) {
  const m = SEMVER.exec(tag)
  return m ? { major: m[1], minor: m[2], patch: m[3], pre: m[4] ?? null } : null
}

// A branch or tag name as a valid image tag: odd characters become "-", and it can't start with "." or "-".
export function sanitizeTag(s: string) {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 128)
}

// Tags for a build. A template with a placeholder that has no value here is skipped (no {branch} on a tag
// build, no {version} on a tag that isn't semver, no {major} on a prerelease). Prerelease tags only get {version}.
export function expandTags(templates: string[], ctx: { branch?: string; tag?: string; sha: string }): string[] {
  const sv = ctx.tag ? parseSemver(ctx.tag) : null
  const values: Record<string, string | null> = {
    branch: ctx.branch ? sanitizeTag(ctx.branch) : null,
    tag: ctx.tag ? sanitizeTag(ctx.tag) : null,
    sha: ctx.sha.slice(0, 7),
    version: sv ? `${sv.major}.${sv.minor}.${sv.patch}${sv.pre ? `-${sv.pre}` : ""}` : null,
    major: sv && !sv.pre ? sv.major : null,
    minor: sv && !sv.pre ? sv.minor : null,
    patch: sv && !sv.pre ? sv.patch : null,
  }
  const out: string[] = []
  for (const t of templates) {
    let ok = true
    const s = t.trim().replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = values[k]
      if (v === null || v === undefined || v === "") ok = false
      return v ?? ""
    })
    if (ok && s && validTag(s) && !out.includes(s)) out.push(s)
  }
  return out
}

// Whether a template is well formed (only known placeholders, and a valid tag once they're filled in).
export function templateError(t: string): string | null {
  const known = ["branch", "tag", "sha", "version", "major", "minor", "patch"]
  const bad = [...t.matchAll(/\{(\w*)\}/g)].find((m) => !known.includes(m[1]))
  if (bad) return `${bad[0]} isn't a tag placeholder. Use {branch}, {tag}, {sha}, {version}, {major}, {minor} or {patch}.`
  if (/[{}]/.test(t.replace(/\{\w+\}/g, ""))) return "Unmatched { or } in the tag."
  if (!validTag(t.replace(/\{\w+\}/g, "x"))) return `"${t}" isn't a valid image tag.`
  return null
}

// ---- matching ---------------------------------------------------------------------

export function matchRule(rule: { sourceType: "branch" | "tag"; pattern: string }, ref: { type: "branch" | "tag"; name: string }) {
  return rule.sourceType === ref.type && matchPattern(rule.pattern, ref.name)
}

// "refs/heads/main" → branch main, "refs/tags/v1" → tag v1; anything else is null.
export function parseRef(ref: string): { type: "branch" | "tag"; name: string } | null {
  const m = /^refs\/(heads|tags)\/(.+)$/.exec(ref)
  return m ? { type: m[1] === "heads" ? "branch" : "tag", name: m[2] } : null
}

// The highest stable version among tag names (a prerelease only when nothing else is semver); null when there are none.
export function latestTag(names: string[]): string | null {
  const key = (n: string) => {
    const s = parseSemver(n)
    return s ? [s.pre ? 0 : 1, Number(s.major), Number(s.minor), Number(s.patch)] : null
  }
  const sorted = [...names].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    if (x && y) for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i]
    return x ? -1 : y ? 1 : b.localeCompare(a)
  })
  return sorted[0] ?? null
}

// ---- validation ---------------------------------------------------------------------

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_ID = /^[A-Za-z0-9_.-]{1,64}$/

const relPath = (p: string, label: string) =>
  !p || p.startsWith("/") || p.includes("\0") || p.split(/[\\/]/).includes("..") ? `${label} must be a path inside the repository.` : null

const FIELD = /^(\*|\d+|\d+-\d+)(\/\d+)?(,(\*|\d+|\d+-\d+)(\/\d+)?)*$/

export function validateRule(input: unknown): { rule?: RuleInput; error?: string } {
  const r = (input ?? {}) as Record<string, unknown>
  const str = (v: unknown, d = "") => (typeof v === "string" ? v.trim() : d)
  const sourceType = r.sourceType
  if (sourceType !== "branch" && sourceType !== "tag") return { error: "Pick Branch or Tag." }
  const pattern = str(r.pattern)
  if (!pattern || pattern.length > 200) return { error: "Enter a branch or tag pattern, like main, release/*, or re:^v\\d+$." }
  if (pattern.startsWith("re:"))
    try {
      new RegExp(pattern.slice(3))
    } catch {
      return { error: "That regular expression isn't valid." }
    }
  const tags = (Array.isArray(r.tags) ? r.tags : []).map((t) => str(t)).filter(Boolean)
  if (!tags.length || tags.length > 10) return { error: "Add 1 to 10 image tags." }
  for (const t of tags) {
    const e = templateError(t)
    if (e) return { error: e }
  }
  const dockerfile = str(r.dockerfile, "Dockerfile") || "Dockerfile"
  const context = str(r.context, ".") || "."
  const pe = relPath(dockerfile, "The Dockerfile") ?? (context === "." ? null : relPath(context, "The context folder"))
  if (pe) return { error: pe }

  const args = Array.isArray(r.buildArgs) ? (r.buildArgs as { key?: unknown; value?: unknown }[]) : []
  if (args.length > 50) return { error: "At most 50 build arguments." }
  const buildArgs: RuleInput["buildArgs"] = []
  for (const a of args) {
    const key = str(a?.key)
    const value = typeof a?.value === "string" ? a.value : ""
    if (!key && !value) continue
    if (!ENV_KEY.test(key)) return { error: `"${key}" isn't a valid build argument name.` }
    if (buildArgs.some((b) => b.key === key)) return { error: `Build argument ${key} is listed twice.` }
    if (value.length > 4000 || value.includes("\0")) return { error: `The value of ${key} is too long.` }
    buildArgs.push({ key, value })
  }
  const refs = Array.isArray(r.secretRefs) ? (r.secretRefs as Record<string, unknown>[]) : []
  if (refs.length > 20) return { error: "At most 20 build secrets." }
  const secretRefs: RuleInput["secretRefs"] = []
  for (const s of refs) {
    const ref = { id: str(s?.id), projectId: str(s?.projectId), env: str(s?.env), key: str(s?.key) }
    if (!ref.id || !ref.projectId || !SECRET_ID.test(ref.key)) return { error: "A build secret reference is incomplete." }
    if (secretRefs.some((x) => x.key === ref.key)) return { error: `Two build secrets are called ${ref.key}.` }
    secretRefs.push(ref)
  }
  const platforms = (Array.isArray(r.platforms) ? r.platforms : []).map((p) => str(p)).filter(Boolean)
  if (platforms.length > 4 || platforms.some((p) => !PLATFORMS.includes(p))) return { error: `Platforms can be ${PLATFORMS.join(", ")} (up to 4).` }
  let schedule: string | null = str(r.schedule) || null
  if (schedule) {
    const f = schedule.split(/\s+/)
    if (f.length !== 5 || !f.every((x) => FIELD.test(x))) return { error: "The schedule is a cron line of five fields, like 0 3 * * *." }
    schedule = f.join(" ")
  }
  return {
    rule: {
      sourceType,
      pattern,
      tags: [...new Set(tags)],
      dockerfile,
      context,
      buildArgs,
      secretRefs,
      platforms: [...new Set(platforms)],
      failOnCritical: r.failOnCritical === true,
      schedule,
      enabled: r.enabled !== false,
    },
  }
}

// ---- the buildctl command line ------------------------------------------------------------

export type BuildctlOpts = {
  addr: string
  contextDir: string
  dockerfileDir: string
  dockerfileName: string
  platforms: string[]
  buildArgs: { key: string; value: string }[]
  // Env var name per secret id; the values are set only in buildctl's own environment.
  secretEnv: { id: string; env: string }[]
  // host/namespace/repo as buildkitd reaches it.
  image: string
  insecure: boolean
  metadataFile: string
}

export function buildctlArgs(o: BuildctlOpts): string[] {
  const reg = o.insecure ? ",registry.insecure=true" : ""
  const cache = `type=registry,ref=${o.image}:${BUILD_CACHE_TAG}${reg}`
  return [
    "--addr", o.addr,
    "build",
    "--frontend", "dockerfile.v0",
    "--local", `context=${o.contextDir}`,
    "--local", `dockerfile=${o.dockerfileDir}`,
    "--opt", `filename=${o.dockerfileName}`,
    ...(o.platforms.length ? ["--opt", `platform=${o.platforms.join(",")}`] : []),
    ...o.buildArgs.flatMap((a) => ["--opt", `build-arg:${a.key}=${a.value}`]),
    ...o.secretEnv.flatMap((s) => ["--secret", `id=${s.id},env=${s.env}`]),
    "--opt", "attest:sbom=",
    "--opt", "attest:provenance=mode=max",
    "--import-cache", cache,
    "--export-cache", `${cache},mode=max`,
    "--output", `type=image,name=${o.image},push-by-digest=true,name-canonical=true,push=true${reg}`,
    "--metadata-file", o.metadataFile,
    "--progress", "plain",
  ]
}

// Hides secret values (and anything base64 of them) in a log line. Values under 4 characters aren't
// hidden: they'd blank out ordinary words.
export function maskLine(line: string, secrets: string[]): string {
  let out = line
  for (const s of secrets) {
    if (s.length < 4) continue
    out = out.split(s).join("***")
    const b = Buffer.from(s).toString("base64")
    if (b.length >= 8) out = out.split(b).join("***")
  }
  return out
}

// "Waiting: server busy (RAM 92%, limit 80%)"
export const waitingText = (reason: string) => `Waiting: server busy (${reason})`

// ---- Redis keys and channels shared by the app and the runner ---------------------------------------------

// Live log: each line is published as {s: seq, t: text} on events:<channel>, and kept in a capped list for late joiners.
export const buildChannel = (id: string) => `registry-build:${id}`
export const buildLogKey = (id: string) => `registry-build:log:${id}`
export const buildHeartbeat = "registry:build:heartbeat"
export const buildCacheKey = "registry:build:cache"
export const buildCancelKey = (id: string) => `registry-build:cancel:${id}`
