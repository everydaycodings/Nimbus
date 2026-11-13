// ACME (Let's Encrypt and friends): an account per project and directory, and orders that
// end in a certificate in the store. Challenges: http-01 (Nimbus answers at
// /.well-known/acme-challenge), dns-01 through a stored Cloudflare / Route 53 /
// DigitalOcean credential, or a manual TXT record the person adds and then verifies.
import "server-only"

import dns from "node:dns/promises"

import acme from "acme-client"
import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretAcmeAccounts, secretAcmeOrders, secretCerts, secretDnsCreds } from "@/lib/db/schema"
import { CRED_FIELDS } from "./acme-fields"
import { challengeName, dnsWriter, type DnsCreds, type DnsProvider, type Undo } from "./acme-dns"
import { arrange, certInfo } from "./pki-core"
import { SecretsError, seal, systemCtx, unseal, type Ctx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m)

const DIRS: Record<string, string> = {
  staging: "https://acme-staging-v02.api.letsencrypt.org/directory",
  production: "https://acme-v02.api.letsencrypt.org/directory",
}
// A custom directory (Pebble, ZeroSSL, a private ACME CA) only when the server owner allows it.
export const customAllowed = () => process.env.ACME_ALLOW_CUSTOM_DIRECTORY === "1"
const dirUrl = (d: string) => {
  if (DIRS[d]) return DIRS[d]
  if (d.startsWith("custom:") && customAllowed()) return d.slice(7)
  throw bad("That ACME directory isn't allowed on this server.")
}

const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

// ---- Accounts and DNS credentials -------------------------------------------------

export async function listAccounts(c: Ctx) {
  const rows = await db.select().from(secretAcmeAccounts).where(eq(secretAcmeAccounts.projectId, c.projectId))
  return rows.map((r) => ({ id: r.id, directory: r.directory, email: r.email, createdAt: r.createdAt.toISOString() }))
}

export async function addAccount(c: Ctx, directory: string, email: string) {
  const mail = email.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw bad("Enter the email Let's Encrypt can reach you at.")
  const url = dirUrl(directory)
  const [dup] = await db.select({ id: secretAcmeAccounts.id }).from(secretAcmeAccounts).where(and(eq(secretAcmeAccounts.projectId, c.projectId), eq(secretAcmeAccounts.directory, directory)))
  if (dup) throw bad("This project already has an account for that directory.", 409)
  const key = (await acme.crypto.createPrivateEcdsaKey()).toString()
  try {
    await new acme.Client({ directoryUrl: url, accountKey: key }).createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${mail}`] })
  } catch (e) {
    throw bad(`The ACME server refused the account: ${(e as Error).message}`, 502)
  }
  await db.insert(secretAcmeAccounts).values({ projectId: c.projectId, directory, email: mail, keyEnc: seal(c, key) })
  await audit("secrets_acme_account", { detail: `${directory} (${mail})` })
}

export async function deleteAccount(c: Ctx, id: string) {
  const [used] = await db.select({ id: secretCerts.id }).from(secretCerts).where(and(eq(secretCerts.projectId, c.projectId), sql`${secretCerts.acme}->>'accountId' = ${id}`)).limit(1)
  if (used) throw bad("Certificates use this account. Delete them first.", 409)
  await db.delete(secretAcmeAccounts).where(and(eq(secretAcmeAccounts.id, id), eq(secretAcmeAccounts.projectId, c.projectId)))
}

export async function listDnsCreds(c: Ctx) {
  const rows = await db.select({ id: secretDnsCreds.id, name: secretDnsCreds.name, provider: secretDnsCreds.provider }).from(secretDnsCreds).where(eq(secretDnsCreds.projectId, c.projectId))
  return rows
}

export async function addDnsCred(c: Ctx, name: string, provider: string, creds: DnsCreds) {
  if (!(provider in CRED_FIELDS)) throw bad("Pick a DNS provider.")
  const p = provider as DnsProvider
  const n = name.trim().slice(0, 60)
  if (!n) throw bad("Name the credential.")
  const only: DnsCreds = {}
  for (const { key, label } of CRED_FIELDS[p]) {
    if (!creds[key]?.trim()) throw bad(`${label} is missing.`)
    only[key] = creds[key]!.trim()
  }
  await db.insert(secretDnsCreds).values({ projectId: c.projectId, name: n, provider: p, credEnc: seal(c, JSON.stringify(only)) })
  await audit("secrets_dns_cred", { detail: `${n} (${p})` })
}

export async function deleteDnsCred(c: Ctx, id: string) {
  await db.delete(secretDnsCreds).where(and(eq(secretDnsCreds.id, id), eq(secretDnsCreds.projectId, c.projectId)))
}

// ---- Orders ------------------------------------------------------------------------

const orderCard = (r: typeof secretAcmeOrders.$inferSelect) => ({
  id: r.id,
  name: r.name,
  domains: r.domains,
  challenge: r.challenge,
  status: r.status,
  error: r.error,
  certId: r.certId,
  createdAt: r.createdAt.toISOString(),
  // Manual TXT records to add; nothing secret in them.
  records: r.status === "awaiting" ? r.challenges.filter((x) => x.record).map((x) => ({ domain: x.domain, ...x.record! })) : [],
})

export async function listOrders(c: Ctx) {
  const rows = await db.select().from(secretAcmeOrders).where(eq(secretAcmeOrders.projectId, c.projectId)).orderBy(desc(secretAcmeOrders.createdAt)).limit(30)
  return rows.map(orderCard)
}

export async function startOrder(
  c: Ctx,
  o: { accountId: string; name: string; domains: string[]; challenge: string; credId: string | null; autoRenew: boolean; renewCertId?: string },
  wait = false
) {
  const domains = [...new Set(o.domains.map((d) => d.trim().toLowerCase()).filter(Boolean))]
  if (!domains.length || domains.length > 20) throw bad("Enter between 1 and 20 domain names.")
  for (const d of domains) if (!HOST.test(d)) throw bad(`“${d}” isn't a valid domain name.`)
  if (!["http-01", "dns-01", "manual"].includes(o.challenge)) throw bad("Pick a challenge.")
  const ch = o.challenge as "http-01" | "dns-01" | "manual"
  if (ch === "http-01" && domains.some((d) => d.startsWith("*."))) throw bad("Wildcard names need a DNS challenge.")
  const [acct] = await db.select({ id: secretAcmeAccounts.id }).from(secretAcmeAccounts).where(and(eq(secretAcmeAccounts.id, o.accountId), eq(secretAcmeAccounts.projectId, c.projectId)))
  if (!acct) throw bad("Pick an ACME account.")
  if (ch === "dns-01") {
    const [cred] = o.credId ? await db.select({ id: secretDnsCreds.id }).from(secretDnsCreds).where(and(eq(secretDnsCreds.id, o.credId), eq(secretDnsCreds.projectId, c.projectId))) : []
    if (!cred) throw bad("Pick a DNS credential.")
  }
  const name = o.name.trim().slice(0, 80) || domains[0]
  const [row] = await db
    .insert(secretAcmeOrders)
    .values({ projectId: c.projectId, accountId: o.accountId, name, domains, challenge: ch, credId: ch === "dns-01" ? o.credId : null, autoRenew: ch === "manual" ? false : o.autoRenew, status: "working", renewCertId: o.renewCertId ?? null, createdBy: c.userId || null })
    .returning({ id: secretAcmeOrders.id })
  await audit("secrets_acme_order", { detail: `${name}: ${domains.join(", ")} (${ch})` })
  const run = prepare(c.projectId, row.id).catch((e) => fail(row.id, e))
  if (wait) await run
  else void run
  return row.id
}

const fail = (id: string, e: unknown) => {
  console.error("[acme] order failed:", e)
  return db.update(secretAcmeOrders).set({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 500), orderEnc: null, keyEnc: null }).where(eq(secretAcmeOrders.id, id))
}

async function parts(projectId: string, id: string) {
  const [o] = await db.select().from(secretAcmeOrders).where(eq(secretAcmeOrders.id, id))
  const [a] = o ? await db.select().from(secretAcmeAccounts).where(eq(secretAcmeAccounts.id, o.accountId)) : []
  const c = await systemCtx(projectId)
  if (!o || !a || !c) throw new Error("The order is gone.")
  const client = new acme.Client({ directoryUrl: dirUrl(a.directory), accountKey: unseal(c, a.keyEnc) })
  // The account URL isn't stored; the CA hands it back for the key.
  await client.createAccount({ onlyReturnExisting: true })
  return { o, c, client, account: a }
}

// Open the order and publish what the CA will look for, then (unless a person must act) finish.
async function prepare(projectId: string, id: string) {
  const { o, c, client } = await parts(projectId, id)
  const order = await client.createOrder({ identifiers: o.domains.map((value) => ({ type: "dns", value })) })
  const authzs = await client.getAuthorizations(order)
  const want = o.challenge === "http-01" ? "http-01" : "dns-01"
  const challenges: (typeof o.challenges)[number][] = []
  for (const az of authzs) {
    const ch = az.challenges.find((x) => x.type === want)
    if (!ch) throw new Error(`The CA offers no ${want} challenge for ${az.identifier.value}.`)
    const keyAuth = await client.getChallengeKeyAuthorization(ch)
    challenges.push({
      domain: ((az as { wildcard?: boolean }).wildcard ? "*." : "") + az.identifier.value,
      type: want,
      token: ch.token,
      keyAuth,
      url: ch.url,
      // For dns-01 acme-client's key authorization is already the TXT value (the digest).
      ...(want === "dns-01" ? { record: { name: challengeName(az.identifier.value), value: keyAuth } } : {}),
    })
  }
  const key = (await acme.crypto.createPrivateEcdsaKey()).toString()
  const manual = o.challenge === "manual"
  await db
    .update(secretAcmeOrders)
    .set({ orderEnc: seal(c, JSON.stringify(order)), keyEnc: seal(c, key), challenges, status: manual ? "awaiting" : "working" })
    .where(eq(secretAcmeOrders.id, id))
  if (manual) return
  await finish(projectId, id)
}

// Tell the CA to check, wait for it, finalize and store the certificate.
async function finish(projectId: string, id: string) {
  const { o, c, client } = await parts(projectId, id)
  let undo: Undo[] = []
  try {
    if (o.challenge === "dns-01") {
      const [cr] = await db.select().from(secretDnsCreds).where(eq(secretDnsCreds.id, o.credId ?? ""))
      if (!cr) throw new Error("The DNS credential was deleted.")
      const put = dnsWriter(cr.provider, JSON.parse(unseal(c, cr.credEnc)) as DnsCreds, undefined, process.env.ACME_DNS_API_BASE)
      for (const ch of o.challenges) undo.push(await put(ch.record!.name, ch.record!.value))
      await waitForTxt(o.challenges.map((x) => x.record!))
    }
    const order = JSON.parse(unseal(c, o.orderEnc!)) as Awaited<ReturnType<typeof client.createOrder>>
    for (const ch of o.challenges) {
      const obj = { type: ch.type, url: ch.url, token: ch.token, status: "pending" } as never
      await client.completeChallenge(obj)
      await client.waitForValidStatus(obj)
    }
    const key = unseal(c, o.keyEnc!)
    const [, csr] = await acme.crypto.createCsr({ commonName: o.domains[0], altNames: o.domains }, key)
    const fin = await client.finalizeOrder(order, csr)
    const pem = await client.getCertificate(fin)
    const split = acme.crypto.splitPemChain(pem)
    const a = arrange(split, key)
    const info = certInfo(a.leaf)
    const vals = { certPem: a.leaf, chainPem: a.chain.join(""), keyEnc: seal(c, key), subject: info.subject, issuer: info.issuer, serial: info.serial, sans: info.sans, keyType: info.keyType, fingerprint: info.fingerprint, notBefore: info.notBefore, notAfter: info.notAfter, warnedDays: null }
    const acmeCfg = { accountId: o.accountId, domains: o.domains, challenge: o.challenge, credId: o.credId, autoRenew: o.autoRenew }
    let certId = o.renewCertId
    if (certId) await db.update(secretCerts).set({ ...vals, acme: acmeCfg }).where(eq(secretCerts.id, certId))
    else [{ id: certId }] = await db.insert(secretCerts).values({ projectId, name: o.name, source: "acme", ...vals, acme: acmeCfg, createdBy: o.createdBy }).returning({ id: secretCerts.id })
    await db.update(secretAcmeOrders).set({ status: "issued", certId, error: null, orderEnc: null, keyEnc: null, challenges: [] }).where(eq(secretAcmeOrders.id, id))
  } catch (e) {
    await fail(id, e)
    throw e
  } finally {
    for (const u of undo) await u().catch(() => {})
    undo = []
  }
}

// Give DNS a moment to show the records (the CA asks the public DNS). Gives up quietly: the CA has the last word.
async function waitForTxt(records: { name: string; value: string }[]) {
  const limit = Number(process.env.ACME_DNS_WAIT_SECONDS ?? 90)
  for (let t = 0; ; t += 5) {
    const seen = await Promise.all(records.map((r) => txtSeen(r.name, r.value)))
    if (seen.every(Boolean) || t >= limit) return
    await new Promise((r) => setTimeout(r, 5000))
  }
}

async function txtSeen(name: string, value: string) {
  try {
    const r = new dns.Resolver()
    // ACME_DNS_RESOLVER: ask this resolver (host or host:port) instead of the system's, e.g. a private one.
    if (process.env.ACME_DNS_RESOLVER) r.setServers([process.env.ACME_DNS_RESOLVER])
    return (await r.resolveTxt(name)).some((parts) => parts.join("") === value)
  } catch {
    return false
  }
}

// Manual flow: check the TXT records show up, then let the CA validate.
export async function verifyOrder(c: Ctx, id: string) {
  const [o] = await db.select().from(secretAcmeOrders).where(and(eq(secretAcmeOrders.id, id), eq(secretAcmeOrders.projectId, c.projectId)))
  if (!o) throw bad("That order isn't here.", 404)
  if (o.status !== "awaiting") throw bad("This order isn't waiting for a record.", 409)
  const miss = []
  for (const ch of o.challenges) if (ch.record && !(await txtSeen(ch.record.name, ch.record.value))) miss.push(ch.record.name)
  if (miss.length) throw bad(`Not visible in DNS yet: ${miss.join(", ")}. Records can take a few minutes to spread.`, 409)
  await db.update(secretAcmeOrders).set({ status: "working" }).where(eq(secretAcmeOrders.id, id))
  void finish(c.projectId, id).catch(() => {})
}

export async function deleteOrder(c: Ctx, id: string) {
  await db.delete(secretAcmeOrders).where(and(eq(secretAcmeOrders.id, id), eq(secretAcmeOrders.projectId, c.projectId)))
}

// The public HTTP-01 answer. Only orders still being worked on.
export async function httpAnswer(token: string) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(token)) return null
  const [r] = await db
    .select({ ch: secretAcmeOrders.challenges })
    .from(secretAcmeOrders)
    .where(and(inArray(secretAcmeOrders.status, ["working", "awaiting"]), sql`${secretAcmeOrders.challenges} @> ${JSON.stringify([{ token }])}::jsonb`))
    .limit(1)
  return r?.ch.find((x) => x.token === token && x.type === "http-01")?.keyAuth ?? null
}

// Worker: renew what's within 30 days. Returns what it renewed and what failed.
export async function renewDue() {
  const due = await db
    .select()
    .from(secretCerts)
    .where(sql`${secretCerts.acme} is not null and (${secretCerts.acme}->>'autoRenew')::boolean and ${secretCerts.notAfter} < now() + interval '30 days' and ${secretCerts.revokedAt} is null and coalesce((${secretCerts.acme}->>'failedAt')::timestamptz, 'epoch') < now() - interval '1 day'`)
  const out: { renewed: { projectId: string; name: string }[]; failed: { projectId: string; name: string; error: string }[] } = { renewed: [], failed: [] }
  for (const cert of due) {
    const cfg = cert.acme!
    const [busy] = await db.select({ id: secretAcmeOrders.id }).from(secretAcmeOrders).where(and(eq(secretAcmeOrders.renewCertId, cert.id), inArray(secretAcmeOrders.status, ["working", "awaiting"])))
    if (busy) continue
    const c = await systemCtx(cert.projectId)
    if (!c) continue
    try {
      const id = await startOrder(c, { accountId: cfg.accountId, name: cert.name, domains: cfg.domains, challenge: cfg.challenge, credId: cfg.credId, autoRenew: true, renewCertId: cert.id }, true)
      const [o] = await db.select({ status: secretAcmeOrders.status, error: secretAcmeOrders.error }).from(secretAcmeOrders).where(eq(secretAcmeOrders.id, id))
      if (o?.status !== "issued") throw new Error(o?.error ?? "The order didn't finish.")
      out.renewed.push({ projectId: cert.projectId, name: cert.name })
    } catch (e) {
      await db.update(secretCerts).set({ acme: { ...cfg, failedAt: new Date().toISOString() } }).where(eq(secretCerts.id, cert.id))
      out.failed.push({ projectId: cert.projectId, name: cert.name, error: (e as Error).message })
    }
  }
  return out
}
