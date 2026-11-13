// DNS-01 record writers for Cloudflare, Route 53 and DigitalOcean. Each takes the
// API base URL so tests can point it at a local fake. No SDKs: three small REST calls each.
// Relative-import safe so node --test can load it.
import { createHash, createHmac } from "node:crypto"

import { CRED_FIELDS, type DnsCreds, type DnsProvider } from "./acme-fields.ts"

export type { DnsCreds, DnsProvider }
export type Undo = () => Promise<void>

export const challengeName = (domain: string) => `_acme-challenge.${domain.replace(/^\*\./, "")}`

// The domain and each parent above it, most specific first, stopping before the bare TLD.
const parents = (name: string) => {
  const parts = name.replace(/\.$/, "").split(".")
  return parts.slice(0, -1).map((_, i) => parts.slice(i).join("."))
}

async function call(f: typeof fetch, url: string, init: RequestInit, what: string) {
  const res = await f(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${what} refused (${res.status}): ${text.slice(0, 200)}`)
  return text ? text : "{}"
}

export function cloudflare(creds: DnsCreds, f: typeof fetch = fetch, base = "https://api.cloudflare.com/client/v4") {
  const h = { authorization: `Bearer ${creds.token}`, "content-type": "application/json" }
  return async (name: string, value: string): Promise<Undo> => {
    let zone: string | null = null
    for (const d of parents(name)) {
      const r = JSON.parse(await call(f, `${base}/zones?name=${encodeURIComponent(d)}`, { headers: h }, "Cloudflare"))
      if (r.result?.[0]?.id) {
        zone = r.result[0].id
        break
      }
    }
    if (!zone) throw new Error(`Cloudflare has no zone for ${name} on this token.`)
    const r = JSON.parse(await call(f, `${base}/zones/${zone}/dns_records`, { method: "POST", headers: h, body: JSON.stringify({ type: "TXT", name, content: value, ttl: 60 }) }, "Cloudflare"))
    return async () => void (await call(f, `${base}/zones/${zone}/dns_records/${r.result.id}`, { method: "DELETE", headers: h }, "Cloudflare"))
  }
}

export function digitalocean(creds: DnsCreds, f: typeof fetch = fetch, base = "https://api.digitalocean.com/v2") {
  const h = { authorization: `Bearer ${creds.token}`, "content-type": "application/json" }
  return async (name: string, value: string): Promise<Undo> => {
    let zone: string | null = null
    for (const d of parents(name)) {
      const res = await f(`${base}/domains/${d}`, { headers: h })
      if (res.ok) {
        zone = d
        break
      }
      if (res.status !== 404) throw new Error(`DigitalOcean refused (${res.status}).`)
    }
    if (!zone) throw new Error(`DigitalOcean has no domain for ${name} on this token.`)
    const rel = name === zone ? "@" : name.slice(0, -zone.length - 1)
    const r = JSON.parse(await call(f, `${base}/domains/${zone}/records`, { method: "POST", headers: h, body: JSON.stringify({ type: "TXT", name: rel, data: value, ttl: 30 }) }, "DigitalOcean"))
    return async () => void (await call(f, `${base}/domains/${zone}/records/${r.domain_record.id}`, { method: "DELETE", headers: h }, "DigitalOcean"))
  }
}

// ---- Route 53 (AWS Signature V4) -------------------------------------------

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s).digest()

export function sigV4(o: { method: string; host: string; path: string; query?: string; body: string; amzDate: string; region: string; service: string; accessKeyId: string; secretAccessKey: string; extra?: Record<string, string> }) {
  const date = o.amzDate.slice(0, 8)
  const headers: Record<string, string> = { host: o.host, "x-amz-date": o.amzDate, ...o.extra }
  const names = Object.keys(headers).sort()
  const canonical = [o.method, o.path, o.query ?? "", names.map((n) => `${n}:${headers[n].trim()}\n`).join(""), names.join(";"), sha(o.body)].join("\n")
  const scope = `${date}/${o.region}/${o.service}/aws4_request`
  const sts = ["AWS4-HMAC-SHA256", o.amzDate, scope, sha(canonical)].join("\n")
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretAccessKey}`, date), o.region), o.service), "aws4_request")
  const sig = createHmac("sha256", key).update(sts).digest("hex")
  return { authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`, signature: sig }
}

export function route53(creds: DnsCreds, f: typeof fetch = fetch, base = "https://route53.amazonaws.com") {
  const u = new URL(base)
  const signed = async (method: string, path: string, query = "", body = "") => {
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")
    const s = sigV4({ method, host: u.host, path, query, body, amzDate, region: "us-east-1", service: "route53", accessKeyId: creds.accessKeyId ?? "", secretAccessKey: creds.secretAccessKey ?? "" })
    return call(f, `${base}${path}${query ? `?${query}` : ""}`, { method, body: body || undefined, headers: { "x-amz-date": amzDate, authorization: s.authorization, ...(body ? { "content-type": "text/xml" } : {}) } }, "Route 53")
  }
  const change = (action: "UPSERT" | "DELETE", name: string, value: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeBatch><Changes><Change><Action>${action}</Action><ResourceRecordSet><Name>${name}</Name><Type>TXT</Type><TTL>60</TTL><ResourceRecords><ResourceRecord><Value>"${value}"</Value></ResourceRecord></ResourceRecords></ResourceRecordSet></Change></Changes></ChangeBatch></ChangeResourceRecordSetsRequest>`
  return async (name: string, value: string): Promise<Undo> => {
    const zones = await signed("GET", "/2013-04-01/hostedzone")
    const list = [...zones.matchAll(/<HostedZone>[\s\S]*?<Id>\/hostedzone\/([^<]+)<\/Id>[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => ({ id: m[1], name: m[2].replace(/\.$/, "") }))
    const zone = parents(name).map((d) => list.find((z) => z.name === d)).find(Boolean)
    if (!zone) throw new Error(`Route 53 has no hosted zone for ${name} on these credentials.`)
    await signed("POST", `/2013-04-01/hostedzone/${zone.id}/rrset`, "", change("UPSERT", name, value))
    return async () => void (await signed("POST", `/2013-04-01/hostedzone/${zone.id}/rrset`, "", change("DELETE", name, value)))
  }
}

export function dnsWriter(provider: DnsProvider, creds: DnsCreds, f?: typeof fetch, base?: string) {
  const make = { cloudflare, digitalocean, route53 }[provider]
  for (const { key, label } of CRED_FIELDS[provider]) if (!creds[key]?.trim()) throw new Error(`${label} is missing.`)
  return make(creds, f, base)
}
