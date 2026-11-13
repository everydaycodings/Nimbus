// Finds likely secrets in text, in the manner of gitleaks: a list of provider-shaped
// patterns plus a generic "name = high-entropy value" rule, minus an allow list of
// placeholders. Pure (relative imports only) so node --test loads it. A finding
// keeps the line, a masked preview and a hash; `match` is for the caller to use in
// memory (Move to Secrets, redact) and must never be stored.
import { createHash } from "node:crypto"

export type Rule = { id: string; label: string; re: RegExp; group?: number; generic?: boolean }

export const RULES: Rule[] = [
  { id: "aws-access-key", label: "AWS access key", re: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g },
  { id: "aws-secret-key", label: "AWS secret key", re: /aws.{0,20}?(?:secret|sk).{0,20}?['"=:\s]+([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1 },
  { id: "github-token", label: "GitHub token", re: /\b((?:gh[pousr]_[A-Za-z0-9]{36,255})|(?:github_pat_[A-Za-z0-9_]{60,}))\b/g },
  { id: "gitlab-token", label: "GitLab token", re: /\b(glpat-[0-9A-Za-z_-]{20})\b/g },
  { id: "stripe-key", label: "Stripe key", re: /\b((?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,99})\b/g },
  { id: "slack-token", label: "Slack token", re: /\b(xox[abposr]-[0-9A-Za-z-]{10,72})\b/g },
  { id: "slack-webhook", label: "Slack webhook", re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,})/g },
  { id: "google-api-key", label: "Google API key", re: /\b(AIza[0-9A-Za-z_-]{35})\b/g },
  { id: "sendgrid-key", label: "SendGrid key", re: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g },
  { id: "npm-token", label: "npm token", re: /\b(npm_[A-Za-z0-9]{36})\b/g },
  { id: "private-key", label: "Private key", re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,4096}?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$))/g },
  { id: "jwt", label: "JSON Web Token", re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g },
  {
    id: "generic-secret",
    label: "High-entropy secret",
    re: /(?:api[_-]?key|apikey|secret|token|passwd|password|pwd|auth[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key)[A-Za-z0-9_-]{0,20}["']?\s*[:=]\s*["']?([A-Za-z0-9/+_=.-]{16,100})["']?/gi,
    group: 1,
    generic: true,
  },
]

const PLACEHOLDER = /example|sample|placeholder|changeme|change[_-]?me|your[_-]|<[^>]*>|\$\{|\{\{|%\(|dummy|redacted|\*{3,}|x{5,}|^(?:true|false|null|none|undefined)$|process\.env|getenv|env\[/i

export const entropy = (s: string) => {
  const n = new Map<string, number>()
  for (const ch of s) n.set(ch, (n.get(ch) ?? 0) + 1)
  let e = 0
  for (const c of n.values()) e -= (c / s.length) * Math.log2(c / s.length)
  return e
}

// Values that are obviously stand-ins, so they don't count.
export function isPlaceholder(v: string) {
  if (PLACEHOLDER.test(v)) return true
  if (/^(.)\1+$/.test(v)) return true
  // A path, URL-less word or identifier: letters and separators only, no digits.
  if (/^[a-z_.-]+$/i.test(v) && !/[A-Z].*[a-z]|[a-z].*[A-Z]/.test(v)) return true
  return false
}

export const hashMatch = (m: string) => createHash("sha256").update(m).digest("hex").slice(0, 32)

// First four and last two characters, so a person can recognise it and nobody can use it.
export function mask(rule: string, m: string) {
  if (rule === "private-key") return m.split("\n")[0].trim().slice(0, 40)
  return m.length <= 10 ? `${m.slice(0, 2)}…` : `${m.slice(0, 4)}…${m.slice(-2)}`
}

export type Finding = { rule: string; label: string; line: number; masked: string; hash: string; match: string }

export const MAX_FINDINGS = 50

// `allow` holds hashes marked as false positives. Specific rules run before the generic
// one, and the same text is reported once.
export function scanText(text: string, allow: ReadonlySet<string> = new Set()): Finding[] {
  const out: Finding[] = []
  const seen = new Set<string>()
  const lineAt = (i: number) => {
    let n = 1
    for (let p = text.indexOf("\n"); p !== -1 && p < i; p = text.indexOf("\n", p + 1)) n++
    return n
  }
  for (const r of RULES) {
    r.re.lastIndex = 0
    for (let m = r.re.exec(text); m; m = r.re.exec(text)) {
      const match = m[r.group ?? 1]
      if (match === undefined) continue
      const hash = hashMatch(match)
      if (seen.has(hash) || allow.has(hash)) continue
      if (r.id !== "private-key" && isPlaceholder(match)) continue
      if (r.generic && (entropy(match) < 3.3 || !/\d/.test(match))) continue
      seen.add(hash)
      const at = m.index + m[0].indexOf(match)
      out.push({ rule: r.id, label: r.label, line: lineAt(at), masked: mask(r.id, match), hash, match })
      if (out.length >= MAX_FINDINGS) return out
    }
  }
  return out.sort((a, b) => a.line - b.line)
}

// Which uploads are worth reading: text and code up to 1 MB, not lock files or minified bundles.
export const SCAN_MAX_BYTES = 1024 * 1024
const TEXT_EXT = /\.(txt|md|markdown|env|json|ya?ml|toml|ini|cfg|conf|properties|xml|csv|tsv|log|sh|bash|zsh|ps1|bat|py|rb|php|js|jsx|mjs|cjs|ts|tsx|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sql|tf|tfvars|pem|key|crt|html|css|scss|vue|svelte|gradle|dockerfile)$/i
const SKIP = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|go\.sum)$|\.min\.(?:js|css)$|\.map$/i

export function scannable(name: string, mime: string | null, size: number) {
  if (size <= 0 || size > SCAN_MAX_BYTES) return false
  if (SKIP.test(name)) return false
  return TEXT_EXT.test(name) || /^\.?env(\.|$)/i.test(name) || /^(dockerfile|makefile)$/i.test(name) || Boolean(mime?.startsWith("text/")) || mime === "application/json" || mime === "application/x-yaml"
}

// A NUL byte in the first 8 KB means a binary file.
export const looksBinary = (b: Uint8Array) => b.subarray(0, 8000).includes(0)

// The file with every occurrence of `match` replaced.
export const redact = (text: string, match: string, by = "REDACTED") => text.split(match).join(by)

// What to call the secret when it moves into a project.
export const SUGGESTED_KEY: Record<string, string> = {
  "aws-access-key": "AWS_ACCESS_KEY_ID",
  "aws-secret-key": "AWS_SECRET_ACCESS_KEY",
  "github-token": "GITHUB_TOKEN",
  "gitlab-token": "GITLAB_TOKEN",
  "stripe-key": "STRIPE_SECRET_KEY",
  "slack-token": "SLACK_TOKEN",
  "slack-webhook": "SLACK_WEBHOOK_URL",
  "google-api-key": "GOOGLE_API_KEY",
  "sendgrid-key": "SENDGRID_API_KEY",
  "npm-token": "NPM_TOKEN",
  "private-key": "PRIVATE_KEY",
  jwt: "JWT_TOKEN",
  "generic-secret": "SECRET_VALUE",
}
