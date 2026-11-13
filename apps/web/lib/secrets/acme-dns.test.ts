// Run: node --test lib/secrets/acme-dns.test.ts
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"

import { challengeName, dnsWriter, sigV4 } from "./acme-dns.ts"

type Hit = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }

async function fake(handler: (h: Hit) => [number, string]) {
  const hits: Hit[] = []
  const srv = createServer(async (req, res) => {
    let body = ""
    for await (const c of req) body += c
    const hit = { method: req.method!, url: req.url!, headers: req.headers, body }
    hits.push(hit)
    const [code, text] = handler(hit)
    res.writeHead(code).end(text)
  })
  await new Promise<void>((r) => srv.listen(0, r))
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  return { hits, base, close: () => { srv.closeAllConnections(); srv.close() } }
}

test("names", () => {
  assert.equal(challengeName("*.a.example.com"), "_acme-challenge.a.example.com")
})

test("AWS SigV4 matches the published get-vanilla vector", () => {
  const s = sigV4({ method: "GET", host: "example.amazonaws.com", path: "/", body: "", amzDate: "20150830T123600Z", region: "us-east-1", service: "service", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" })
  assert.equal(s.signature, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31")
})

test("Cloudflare: finds the parent zone, adds and removes the TXT", async () => {
  const f = await fake((h) =>
    h.url.startsWith("/zones?name=") ? [200, JSON.stringify({ result: h.url.endsWith("example.com") ? [{ id: "z1" }] : [] })]
    : h.method === "POST" ? [200, JSON.stringify({ result: { id: "r1" } })] : [200, "{}"])
  const undo = await dnsWriter("cloudflare", { token: "tok" }, fetch, f.base)("_acme-challenge.www.example.com", "VAL")
  const post = f.hits.find((h) => h.method === "POST")!
  assert.equal(post.url, "/zones/z1/dns_records")
  assert.equal(post.headers.authorization, "Bearer tok")
  assert.deepEqual(JSON.parse(post.body), { type: "TXT", name: "_acme-challenge.www.example.com", content: "VAL", ttl: 60 })
  await undo()
  assert.equal(f.hits.at(-1)!.method + f.hits.at(-1)!.url, "DELETE/zones/z1/dns_records/r1")
  f.close()
})

test("Cloudflare reports an API refusal", async () => {
  const f = await fake(() => [403, "nope"])
  await assert.rejects(dnsWriter("cloudflare", { token: "t" }, fetch, f.base)("_acme-challenge.a.com", "v"), /Cloudflare refused \(403\)/)
  f.close()
})

test("DigitalOcean: relative record name", async () => {
  const f = await fake((h) =>
    h.method === "GET" ? (h.url === "/domains/example.com" ? [200, "{}"] : [404, "{}"])
    : h.method === "POST" ? [201, JSON.stringify({ domain_record: { id: 77 } })] : [204, ""])
  const undo = await dnsWriter("digitalocean", { token: "do" }, fetch, f.base)("_acme-challenge.www.example.com", "VAL")
  const post = f.hits.find((h) => h.method === "POST")!
  assert.equal(post.url, "/domains/example.com/records")
  assert.equal(JSON.parse(post.body).name, "_acme-challenge.www")
  assert.equal(post.headers.authorization, "Bearer do")
  await undo()
  assert.equal(f.hits.at(-1)!.url, "/domains/example.com/records/77")
  f.close()
})

test("Route 53: signed requests, UPSERT then DELETE in the right zone", async () => {
  const zones = `<ListHostedZonesResponse><HostedZones><HostedZone><Id>/hostedzone/ZOTHER</Id><Name>other.org.</Name></HostedZone><HostedZone><Id>/hostedzone/Z9</Id><Name>example.com.</Name></HostedZone></HostedZones></ListHostedZonesResponse>`
  const f = await fake((h) => (h.method === "GET" ? [200, zones] : [200, "<ChangeInfo/>"]))
  const undo = await dnsWriter("route53", { accessKeyId: "AKIAX", secretAccessKey: "sek" }, fetch, f.base)("_acme-challenge.example.com", "VAL")
  await undo()
  const posts = f.hits.filter((h) => h.method === "POST")
  assert.equal(posts[0].url, "/2013-04-01/hostedzone/Z9/rrset")
  assert.match(posts[0].body, /<Action>UPSERT<\/Action>[\s\S]*<Name>_acme-challenge.example.com<\/Name>[\s\S]*<Value>"VAL"<\/Value>/)
  assert.match(posts[1].body, /<Action>DELETE<\/Action>/)
  for (const h of f.hits) assert.match(String(h.headers.authorization), /^AWS4-HMAC-SHA256 Credential=AKIAX\/\d{8}\/us-east-1\/route53\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/)
  f.close()
})

test("missing credentials are refused up front", () => {
  assert.throws(() => dnsWriter("route53", { accessKeyId: "a" }), /Secret access key is missing/)
})
