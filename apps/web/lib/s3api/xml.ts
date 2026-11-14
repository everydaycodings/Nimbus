// S3's XML: errors, results, and a small reader for the few request bodies
// that carry XML (DeleteObjects, CompleteMultipartUpload).
import { SigError } from "./sigv4.ts"

export { SigError as S3Error }

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!)

const unesc = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")

// Every <name>…</name> in `xml`: the inner text (still XML).
export function inner(xml: string, name: string) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1])
}

export const text = (xml: string, name: string) => {
  const v = inner(xml, name)[0]
  return v === undefined ? undefined : unesc(v.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1"))
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
const NS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"'

export const tag = (name: string, value: string | number | boolean | undefined | null) =>
  value === undefined || value === null ? "" : `<${name}>${esc(String(value))}</${name}>`

export const wrap = (root: string, body: string) => `${XML_HEAD}<${root} ${NS}>${body}</${root}>`

export function errorXml(code: string, message: string, resource: string, requestId: string) {
  return `${XML_HEAD}<Error>${tag("Code", code)}${tag("Message", message)}${tag("Resource", resource)}${tag("RequestId", requestId)}</Error>`
}

export const isoDate = (d: Date) => d.toISOString()

// Keys come back percent-encoded when the client asked for encoding-type=url.
export const encodeKey = (k: string, url: boolean) =>
  url ? encodeURIComponent(k).replace(/%2F/g, "/").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()) : k
