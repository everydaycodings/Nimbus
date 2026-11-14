// The Documents filter words in search: type:receipt sender:amazon amount>50 year:2025 expires:soon.
// Pure, so the search, the tests and (later) the app read them the same way.

import { parseAmount } from "@nimbus/shared/documents"

export type DocTokens = {
  type?: string
  sender?: string
  minAmount?: number
  maxAmount?: number
  year?: number
  expires?: "soon" | "expired" | "any"
}

const WORD = /(^|\s)(type|sender|year|expires):(?:"([^"]+)"|(\S+))/gi
const AMOUNT = /(^|\s)amount\s*(>=|<=|>|<)\s*([\d.,]*\d)(?=\s|$)/gi

// The words that are filters, and what is left to search for.
export function parseDocTokens(raw: string): {
  rest: string
  tokens: DocTokens
} {
  const tokens: DocTokens = {}
  let rest = raw.replace(
    WORD,
    (m, lead: string, key: string, quoted?: string, plain?: string) => {
      const v = (quoted ?? plain ?? "").trim()
      switch (key.toLowerCase()) {
        case "type":
          tokens.type = v
          break
        case "sender":
          tokens.sender = v
          break
        case "year":
          if (/^\d{4}$/.test(v)) tokens.year = Number(v)
          else return m
          break
        default:
          if (v === "soon" || v === "expired" || v === "any") tokens.expires = v
          else return m
      }
      return lead
    }
  )
  rest = rest.replace(AMOUNT, (_m, lead: string, op: string, n: string) => {
    const v = parseAmount(n)
    if (v === null) return _m
    if (op[0] === ">") tokens.minAmount = v
    else tokens.maxAmount = v
    return lead
  })
  return { rest: rest.replace(/\s+/g, " ").trim(), tokens }
}

export const hasDocTokens = (t: DocTokens) => Object.keys(t).length > 0
