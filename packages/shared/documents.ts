// Documents: guess a file's type, sender, date, amount and expiry from its text and name.
// Pure rules, no imports, so the worker, the server and the app can share them.
// Self-check: node packages/shared/documents.test.ts
// ponytail: English-first keywords, plus a few German ones; a numeric date like 03/04/2025 is read day-first
// unless a part is above 12. Add locales or a setting when a wrong guess in review stops being cheap.

export const DOC_TYPE_KEYS = [
  "invoice",
  "bill",
  "receipt",
  "contract",
  "warranty",
  "id",
  "insurance",
  "tax",
  "statement",
  "medical",
  "certificate",
  "other",
] as const
export type DocTypeKey = (typeof DOC_TYPE_KEYS)[number]

export type KnownSender = { id: string; name: string; patterns: string[] }

export type Extracted = {
  /** YYYY-MM-DD */
  date: string | null
  amount: number | null
  currency: string | null
  /** YYYY-MM-DD: expiry or due date. */
  expiry: string | null
  /** A known sender found in the text. */
  senderId: string | null
  /** The sender's name: the known one, or a guess from the text. */
  senderName: string | null
  /** The lowercase text that matched (or would match) the sender, to learn as a pattern. */
  senderMatch: string | null
  type: DocTypeKey | null
  /** 0 to 1: how much was found. */
  confidence: number
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ")
const monthOf = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1

function iso(y: number, m: number, d: number) {
  if (y < 100) y += y < 70 ? 2000 : 1900
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : null
}

const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
const DATE_RES: { re: RegExp; to: (m: RegExpExecArray) => string | null }[] = [
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, to: (m) => iso(+m[1], +m[2], +m[3]) },
  {
    re: /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g,
    to: (m) => (+m[1] > 12 || +m[2] <= 12 ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2])),
  },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[ .-]+${MON}[a-z]*\\.?,?[ .-]+(\\d{4})\\b`, "gi"), to: (m) => iso(+m[3], monthOf(m[2]), +m[1]) },
  { re: new RegExp(`\\b${MON}[a-z]*\\.?[ ]+(\\d{1,2})(?:st|nd|rd|th)?,?[ ]+(\\d{4})\\b`, "gi"), to: (m) => iso(+m[3], monthOf(m[1]), +m[2]) },
]

const EXPIRY_LABEL = /(expir\w*|valid (until|thru|through|to)|valid till|\bexp\b|due( date)?|pay(ment)? (by|due)|renew\w*|f[aä]llig\w*|g[uü]ltig bis)\W*$/i
const ISSUE_LABEL = /(invoice date|date of issue|issue date|issued( on)?|statement date|bill date|date|datum)\W*$/i

type Hit = { at: number; date: string; expiry: boolean; issue: boolean }

export function findDates(text: string): Hit[] {
  const hits: Hit[] = []
  for (const { re, to } of DATE_RES) {
    for (const m of text.matchAll(re)) {
      const date = to(m as RegExpExecArray)
      if (!date) continue
      const at = m.index!
      // The label sits just before the date, on the same line.
      const before = text.slice(Math.max(0, at - 32), at).split("\n").pop()!
      hits.push({ at, date, expiry: EXPIRY_LABEL.test(before), issue: ISSUE_LABEL.test(before) })
    }
  }
  return hits.sort((a, b) => a.at - b.at).filter((h, i, all) => i === 0 || h.at !== all[i - 1].at)
}

const CURRENCY: Record<string, string> = {
  "€": "EUR", eur: "EUR", "$": "USD", usd: "USD", us$: "USD", "£": "GBP", gbp: "GBP", "₹": "INR", inr: "INR",
  rs: "INR", chf: "CHF", cad: "CAD", aud: "AUD", jpy: "JPY", "¥": "JPY", sek: "SEK", nok: "NOK", dkk: "DKK", pln: "PLN",
}
const CUR = "(€|\\$|£|₹|¥|US\\$|EUR|USD|GBP|INR|CHF|CAD|AUD|JPY|SEK|NOK|DKK|PLN|Rs\\.?)"
// Runs are bounded and a number can't start inside another, so odd text can't blow up the regex.
const NUM = "(?<![\\d,]|\\d\\.)(\\d{1,3}(?:[.,' ]\\d{3}){0,6}(?:[.,]\\d{1,2})?|\\d{1,15}(?:[.,]\\d{1,2})?)"

// "1,234.56", "1.234,56", "12,50" and "1 234,50" all give a number.
export function parseAmount(s: string) {
  const t = s.replace(/[' ]/g, "")
  const dot = t.lastIndexOf(".")
  const comma = t.lastIndexOf(",")
  const decimal = Math.max(dot, comma)
  const tail = decimal < 0 ? 0 : t.length - decimal - 1
  const n = tail === 3 && (dot < 0 || comma < 0) && !/^0[.,]/.test(t)
    ? Number(t.replace(/[.,]/g, "")) // 1.234 or 1,234: thousands
    : decimal < 0
      ? Number(t)
      : Number(t.slice(0, decimal).replace(/[.,]/g, "") + "." + t.slice(decimal + 1))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

type Money = { at: number; amount: number; currency: string | null; total: boolean }
const TOTAL = /(grand total|total due|amount due|balance due|total amount|amount payable|to pay|total|gesamt\w*|betrag|summe|zu zahlen)\W*(?:\w{0,3}\W*)?$/i

function amounts(text: string): Money[] {
  const out: Money[] = []
  const push = (m: RegExpMatchArray, num: string, cur: string | null) => {
    const amount = parseAmount(num)
    if (amount === null || amount <= 0 || amount > 1e9) return
    const at = m.index!
    const before = text.slice(Math.max(0, at - 28), at).split("\n").pop()!
    const lineStart = text.lastIndexOf("\n", at) + 1
    const line = text.slice(lineStart, at)
    // "Subtotal" is not the total.
    const total = TOTAL.test(before) && !/sub\W?total\W*$/i.test(before) && !/\bvat\b|\btax\b/i.test(line.slice(-12))
    out.push({ at, amount, currency: cur ? (CURRENCY[cur.toLowerCase().replace(/\.$/, "")] ?? null) : null, total })
  }
  for (const m of text.matchAll(new RegExp(`${CUR}\\s?${NUM}`, "gi"))) push(m, m[2], m[1])
  for (const m of text.matchAll(new RegExp(`${NUM}\\s?${CUR}(?![a-z])`, "gi"))) push(m, m[1], m[2])
  // A total with no currency sign: "Total 45.20".
  for (const m of text.matchAll(new RegExp(`(?<![a-z])(?:total|amount due|balance due|gesamt\\w*|betrag)\\W{0,4}${NUM}`, "gi"))) {
    const at = m.index! + m[0].length - m[1].length
    if (!out.some((o) => Math.abs(o.at - at) < 4 || (o.at < at && at - o.at < 6))) {
      const amount = parseAmount(m[1])
      if (amount && /[.,]\d{2}$/.test(m[1])) out.push({ at, amount, currency: null, total: true })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

const TYPE_WORDS: Record<Exclude<DocTypeKey, "other">, [RegExp, number][]> = {
  receipt: [
    [/\breceipt\b|quittung|kassenbon/i, 4],
    [/thank you for (your )?(purchase|shopping|visit)/i, 3],
    [/\b(subtotal|change due|cash tendered|card payment|visa|mastercard|paid by)\b/i, 2],
    [/\bpos\b|\bcashier\b|\bstore #?\d/i, 1],
  ],
  invoice: [
    [/\binvoice\b|rechnung/i, 4],
    [/invoice (no|number|#)|rechnungs?nummer|bill to|purchase order|\bpo number\b/i, 3],
    [/\bsubtotal\b|\bvat\b|\bgst\b|payment terms|net \d+/i, 1],
  ],
  bill: [
    [/\bbill\b|utility|electricity|water bill|gas bill|broadband|mobile bill|phone bill/i, 3],
    [/amount due|due date|pay by|payment due|previous balance|account number|meter reading|billing period/i, 2],
  ],
  contract: [
    [/\b(contract|agreement|lease|tenancy|terms and conditions|vertrag|mietvertrag)\b/i, 3],
    [/\b(party|parties|hereinafter|signed by|signature|governing law|termination)\b/i, 1],
  ],
  warranty: [[/\b(warranty|guarantee|garantie)\b/i, 4], [/serial (no|number)|proof of purchase|valid for \d+ (months|years)/i, 2]],
  id: [
    [/\b(passport|driver'?s? licen[cs]e|driving licen[cs]e|identity card|national id|id card|aadhaar|residence permit|personalausweis|f[uü]hrerschein)\b/i, 4],
    [/date of birth|place of birth|nationality|\bdob\b|surname|given names?/i, 2],
  ],
  insurance: [[/\b(insurance|policy (no|number|holder)|premium|insured|versicherung)\b/i, 3], [/coverage|claim|deductible|excess/i, 1]],
  tax: [[/\b(tax return|tax year|form 16|w-?2|1099|steuer\w*|income tax|tax assessment|assessment year)\b/i, 4], [/taxable income|tax payable|refund/i, 1]],
  statement: [
    [/\b(bank statement|account statement|statement of account|kontoauszug|credit card statement)\b/i, 4],
    [/opening balance|closing balance|iban|sort code|transactions?/i, 1],
  ],
  medical: [
    [/\b(prescription|diagnosis|patient|medical report|lab report|discharge|vaccination|hospital|clinic|arzt)\b/i, 3],
    [/dosage|physician|specimen|blood test/i, 1],
  ],
  certificate: [[/\b(certificate|certify|certification|diploma|zeugnis|urkunde)\b/i, 4], [/awarded|completion|hereby/i, 1]],
}

function guessType(text: string, name: string): DocTypeKey | null {
  let best: DocTypeKey | null = null
  let top = 0
  for (const [key, words] of Object.entries(TYPE_WORDS)) {
    let score = 0
    for (const [re, w] of words) {
      if (re.test(name)) score += w * 2 // the file's name is a strong hint
      const hits = text.match(new RegExp(re.source, re.flags.replace("g", "") + "g"))?.length ?? 0
      score += Math.min(hits, 3) * w
    }
    if (score > top) {
      top = score
      best = key as DocTypeKey
    }
  }
  return top >= 3 ? best : null
}

const GENERIC =
  /^(invoice|receipt|bill|statement|tax invoice|page \d+|date|total|amount|customer|order|bank|account|dear|to|from|www|http|tel|phone|fax|email|e-mail|vat|gst|no\b|surname|given|nationality|sex|identity|passport|driver|licen|certificate|agreement|contract|policy|warranty|prescription|report|card|number|description|qty|item)/i
const FROM_LINE = /^[ \t]*(?:from|seller|sold by|issued by|billed by|supplier|vendor|company|von|absender)\s*[:\-]\s*(.{3,60})$/im

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[|•*_#]+/g, "").trim()
const hasWord = (text: string, p: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text)

const LEAD_STOP = /^(invoice|receipt|bill|statement|tax|mobile|electricity|water|gas|monthly|payment|account|date|page|customer|order|tel|phone|www|http)/i
const lead = (head: string) => {
  const words: string[] = []
  for (const w of head.trim().split(/\s+/)) {
    if (words.length >= 3 || !/^\p{Lu}/u.test(w) || LEAD_STOP.test(w) || /\d/.test(w)) break
    words.push(w)
  }
  return words.join(" ")
}

const HEAD = 1500
function findSender(text: string, name: string, known: KnownSender[]) {
  // Only the top of the page: a name further down is usually the recipient or a mention.
  const hay = `${name}\n${text.slice(0, HEAD)}`
  for (const s of known) {
    for (const p of [s.name, ...s.patterns]) {
      if (p.length >= 3 && hasWord(hay, p)) return { id: s.id, name: s.name, match: p.toLowerCase() }
    }
  }
  const from = FROM_LINE.exec(text)?.[1]
  if (from) {
    const n = clean(from.split(/[,\n]/)[0])
    if (n.length >= 2) return { id: null, name: n, match: n.toLowerCase() }
  }
  // PDF text comes as one long line: the first capitalised words, up to a word that says what the document is.
  const head = text.slice(0, 200)
  const lines = head.includes("\n") ? text.split("\n").slice(0, 12) : [lead(head)]
  // The first line that reads like a company name, near the top.
  for (const line of lines) {
    const l = clean(line)
    if (l.length < 3 || l.length > 40 || GENERIC.test(l) || /\d{3,}/.test(l) || /[@:]/.test(l)) continue
    if (!/^\p{Lu}/u.test(l) || (l.match(/\p{L}/gu)?.length ?? 0) < 3) continue
    if (l.split(" ").length > 5) continue
    return { id: null, name: l, match: l.toLowerCase() }
  }
  const domain = /(?:@|www\.)([a-z0-9-]{3,})\.(?:com|net|org|io|de|co|in|uk|eu)\b/i.exec(text)?.[1]
  if (domain) {
    const n = domain[0].toUpperCase() + domain.slice(1)
    return { id: null, name: n, match: domain.toLowerCase() }
  }
  return null
}

export function extractFields(text: string, name: string, senders: KnownSender[] = []): Extracted {
  const t = text.slice(0, 50_000)
  const ds = findDates(t)
  const expiry = ds.find((h) => h.expiry)?.date ?? null
  const rest = ds.filter((h) => !h.expiry)
  const date = (rest.find((h) => h.issue) ?? rest[0])?.date ?? null
  const money = amounts(t)
  // The total's label wins; else the biggest amount that has a currency sign; else the biggest.
  const pick =
    money.filter((m) => m.total).sort((a, b) => b.at - a.at)[0] ??
    [...money.filter((m) => m.currency)].sort((a, b) => b.amount - a.amount)[0] ??
    [...money].sort((a, b) => b.amount - a.amount)[0] ??
    null
  // A currency seen anywhere beats none.
  const currency = pick?.currency ?? money.find((m) => m.currency)?.currency ?? null
  const type = guessType(t, name)
  const s = findSender(t, name, senders)
  const found = [type, date, pick, s].filter(Boolean).length
  return {
    date,
    amount: pick?.amount ?? null,
    currency: pick ? currency : null,
    expiry,
    senderId: s?.id ?? null,
    senderName: s?.name ?? null,
    senderMatch: s?.match ?? null,
    type,
    confidence: Math.min(1, Math.round((found * 0.22 + (expiry ? 0.12 : 0)) * 100) / 100),
  }
}
