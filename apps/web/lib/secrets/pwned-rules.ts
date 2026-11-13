// Have I Been Pwned range check, k-anonymity style: only the first five characters of the
// SHA-1 of a password ever leave this server, and the answer is every suffix with that
// prefix. No imports, so the browser and node --test share it.

// "SUFFIX:COUNT" lines; the Add-Padding header adds fake lines with a count of 0.
export function matchRange(range: string, suffix: string) {
  const want = suffix.toUpperCase()
  for (const line of range.split(/\r?\n/)) {
    const [s, n] = line.trim().split(":")
    if (s?.toUpperCase() === want) return Number(n) || 0
  }
  return 0
}

// Keys whose values should be checked: passwords, not tokens.
export const looksLikePassword = (key: string) =>
  /(?<![a-z])(pass(word|wd)?|pwd)(?![a-z])/i.test(key) || /[a-z]Pass(word|wd)?(?![a-z])/.test(key)
