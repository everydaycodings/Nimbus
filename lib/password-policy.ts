// The owner's rules for new account passwords and vault passphrases, shared by
// the forms and the server. Null policy: the owner hasn't chosen, so it's the
// NIST 800-63B approach: a length floor and the strength meter, no character rules.
export type PasswordPolicy = {
  min: number
  lower: boolean
  upper: boolean
  digit: boolean
  symbol: boolean
  // Characters a password may not contain, e.g. quotes or spaces.
  exclude: string
}

export const POLICY_MIN = 8
export const POLICY_MAX = 128

export function minLength(policy: PasswordPolicy | null, vault = false) {
  return policy?.min ?? (vault ? 12 : 10)
}

type Rule = { label: string; ok: (pw: string) => boolean }

// Character rules only; length is shown by the meter's countdown.
export function passwordRules(policy: PasswordPolicy | null): Rule[] {
  if (!policy) return []
  const rules: Rule[] = []
  if (policy.lower)
    rules.push({ label: "A lowercase letter", ok: (p) => /\p{Ll}/u.test(p) })
  if (policy.upper)
    rules.push({ label: "An uppercase letter", ok: (p) => /\p{Lu}/u.test(p) })
  if (policy.digit)
    rules.push({ label: "A number", ok: (p) => /\p{N}/u.test(p) })
  if (policy.symbol)
    rules.push({ label: "A symbol", ok: (p) => /[^\p{L}\p{N}]/u.test(p) })
  if (policy.exclude) {
    const banned = [...new Set(policy.exclude)]
    const shown = banned.map((c) => (c === " " ? "space" : c)).join(" ")
    rules.push({
      label: `No ${shown}`,
      ok: (p) => !banned.some((c) => p.includes(c)),
    })
  }
  return rules
}

// The first thing wrong with a new password, or null.
export function passwordProblem(
  pw: string,
  policy: PasswordPolicy | null,
  vault = false
) {
  const min = minLength(policy, vault)
  if (pw.length < min) return `Use at least ${min} characters.`
  if (pw.length > POLICY_MAX) return `Use at most ${POLICY_MAX} characters.`
  const miss = passwordRules(policy).find((r) => !r.ok(pw))
  return miss ? `Password rule not met: ${miss.label.toLowerCase()}.` : null
}
