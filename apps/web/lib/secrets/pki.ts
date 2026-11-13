// The certificate store and the private CA. Routes under projects/[id]/certs and /cas
// are thin wrappers. Private keys are sealed with the project key (service.seal).
import "server-only"

import { and, asc, desc, eq, isNotNull } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretCas, secretCertTemplates, secretCerts } from "@/lib/db/schema"
import {
  arrange, buildCrl, certInfo, createCa, csrNames, issueLeaf, keyMatches, nameAllowed, PkiError,
  readFiles, toPfx, type KeyKind, type LeafKind,
} from "./pki-core"
import { SecretsError, seal, systemCtx, unseal, type Ctx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m)
const name80 = (s: unknown) => String(s ?? "").trim().slice(0, 80)

// Parsing and signing problems are the caller's to fix, not server errors.
async function wrap<T>(fn: () => Promise<T> | T) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof PkiError) throw bad(e.message)
    throw e
  }
}

export const publicBase = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")
export const crlUrl = (caId: string) => `${publicBase()}/pki/crl/${caId}.crl`

const REASONS: Record<number, string> = { 0: "unspecified", 1: "key compromise", 3: "affiliation changed", 4: "superseded", 5: "cessation of operation" }

// ---- Store ------------------------------------------------------------------

type Row = typeof secretCerts.$inferSelect
const card = (r: Row) => ({
  id: r.id,
  name: r.name,
  source: r.source,
  subject: r.subject,
  issuer: r.issuer,
  serial: r.serial,
  sans: r.sans,
  keyType: r.keyType,
  fingerprint: r.fingerprint,
  notBefore: r.notBefore.toISOString(),
  notAfter: r.notAfter.toISOString(),
  hasKey: Boolean(r.keyEnc),
  caId: r.caId,
  revokedAt: r.revokedAt?.toISOString() ?? null,
  revokeReason: r.revokeReason === null ? null : (REASONS[r.revokeReason] ?? "unspecified"),
  acme: r.acme ? { domains: r.acme.domains, challenge: r.acme.challenge, autoRenew: r.acme.autoRenew, accountId: r.acme.accountId } : null,
})
export type CertCard = ReturnType<typeof card>

export async function listCerts(c: Ctx) {
  const rows = await db.select().from(secretCerts).where(eq(secretCerts.projectId, c.projectId)).orderBy(asc(secretCerts.notAfter))
  return rows.map(card)
}

async function certRow(c: Ctx, id: string) {
  const [r] = await db.select().from(secretCerts).where(and(eq(secretCerts.id, id), eq(secretCerts.projectId, c.projectId)))
  if (!r) throw bad("That certificate isn't here.", 404)
  return r
}

export async function certDetail(c: Ctx, id: string) {
  const r = await certRow(c, id)
  const chain = r.chainPem ? r.chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [] : []
  return {
    ...card(r),
    keyMatches: r.keyEnc ? keyMatches(r.certPem, unseal(c, r.keyEnc)) : null,
    chain: chain.map((p) => {
      const i = certInfo(p)
      return { subject: i.subject, issuer: i.issuer, notAfter: i.notAfter.toISOString() }
    }),
  }
}

type Parsed = ReturnType<typeof certInfo>
const fields = (i: Parsed) => ({ subject: i.subject, issuer: i.issuer, serial: i.serial, sans: i.sans, keyType: i.keyType, fingerprint: i.fingerprint, notBefore: i.notBefore, notAfter: i.notAfter })

export async function uploadCert(c: Ctx, name: string, files: Buffer[], password: string) {
  const { leaf, chain, keyMatches: ok, keyPem } = await wrap(() => {
    const r = readFiles(files, password)
    const a = arrange(r.certs, r.key)
    return { ...a, keyPem: r.key }
  })
  if (keyPem && ok === false) throw bad("That private key doesn't belong to the certificate.")
  const info = certInfo(leaf)
  const [row] = await db
    .insert(secretCerts)
    .values({ projectId: c.projectId, name: name80(name) || info.cn, source: "upload", certPem: leaf, chainPem: chain.join(""), keyEnc: keyPem ? seal(c, keyPem) : null, ...fields(info), createdBy: c.userId || null })
    .returning()
  await audit("secrets_cert_upload", { detail: `${row.name} (${info.cn})` })
  return card(row)
}

export async function renameCert(c: Ctx, id: string, name: string) {
  const n = name80(name)
  if (!n) throw bad("Name it.")
  await certRow(c, id)
  await db.update(secretCerts).set({ name: n }).where(eq(secretCerts.id, id))
}

export async function setAutoRenew(c: Ctx, id: string, on: boolean) {
  const r = await certRow(c, id)
  if (!r.acme) throw bad("Only certificates from Let's Encrypt renew by themselves.")
  if (on && r.acme.challenge === "manual") throw bad("A manual TXT challenge can't renew by itself. Issue it again when it's due.")
  await db.update(secretCerts).set({ acme: { ...r.acme, autoRenew: on } }).where(eq(secretCerts.id, id))
}

export async function deleteCert(c: Ctx, id: string) {
  const r = await certRow(c, id)
  await db.delete(secretCerts).where(eq(secretCerts.id, id))
  await audit("secrets_cert_delete", { detail: r.name })
}

export type Format = "cert" | "chain" | "fullchain" | "key" | "pfx"
const FORMATS: Format[] = ["cert", "chain", "fullchain", "key", "pfx"]

// A downloadable file. The key and PFX leave only on this path, and are audited.
export async function downloadCert(c: Ctx, id: string, format: string, password: string) {
  if (!FORMATS.includes(format as Format)) throw bad("Pick a format.")
  const r = await certRow(c, id)
  const slug = r.name.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60) || "certificate"
  const f = format as Format
  if ((f === "key" || f === "pfx") && !r.keyEnc) throw bad("This certificate has no private key stored.", 409)
  let body: string | Buffer
  let ext = "pem"
  if (f === "cert") body = r.certPem
  else if (f === "chain") body = r.chainPem || ""
  else if (f === "fullchain") body = r.certPem + r.chainPem
  else if (f === "key") body = unseal(c, r.keyEnc!)
  else {
    if (password.length < 4) throw bad("Choose a password of at least 4 characters for the PFX.")
    body = await wrap(() => toPfx(r.certPem, (r.chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []), unseal(c, r.keyEnc!), password))
    ext = "pfx"
  }
  if (f === "chain" && !body) throw bad("There's no chain stored with this certificate.", 409)
  await audit("secrets_cert_download", { detail: `${r.name}: ${f}` })
  return { body, filename: `${slug}${f === "cert" ? "" : `-${f}`}.${f === "key" ? "key" : ext}`, type: f === "pfx" ? "application/x-pkcs12" : "application/x-pem-file" }
}

export async function revokeCert(c: Ctx, id: string, reason: number) {
  const r = await certRow(c, id)
  if (!r.caId) throw bad("Only certificates issued by a private CA can be revoked here.")
  if (r.revokedAt) throw bad("Already revoked.", 409)
  if (!(reason in REASONS)) throw bad("Pick a reason.")
  await db.update(secretCerts).set({ revokedAt: new Date(), revokeReason: reason }).where(eq(secretCerts.id, id))
  await audit("secrets_cert_revoke", { detail: `${r.name} (${r.serial}): ${REASONS[reason]}` })
}

// ---- Private CAs ---------------------------------------------------------------

export async function listCas(c: Ctx) {
  const rows = await db.select().from(secretCas).where(eq(secretCas.projectId, c.projectId)).orderBy(asc(secretCas.createdAt))
  const tpls = await db
    .select({ t: secretCertTemplates })
    .from(secretCertTemplates)
    .innerJoin(secretCas, eq(secretCas.id, secretCertTemplates.caId))
    .where(eq(secretCas.projectId, c.projectId))
  const issued = await db.select({ caId: secretCerts.caId, revokedAt: secretCerts.revokedAt }).from(secretCerts).where(and(eq(secretCerts.projectId, c.projectId), isNotNull(secretCerts.caId)))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    subject: r.subject,
    notAfter: r.notAfter.toISOString(),
    crlUrl: crlUrl(r.id),
    issued: issued.filter((i) => i.caId === r.id && !i.revokedAt).length,
    revoked: issued.filter((i) => i.caId === r.id && i.revokedAt).length,
    templates: tpls.filter((t) => t.t.caId === r.id).map(({ t }) => ({ id: t.id, name: t.name, kind: t.kind, sanPatterns: t.sanPatterns, maxTtlDays: t.maxTtlDays })),
  }))
}

async function caRow(c: Ctx, id: string) {
  const [r] = await db.select().from(secretCas).where(and(eq(secretCas.id, id), eq(secretCas.projectId, c.projectId)))
  if (!r) throw bad("That CA isn't here.", 404)
  return r
}

export async function addCa(c: Ctx, o: { name: string; cn: string; years: number; keyKind: KeyKind; parentId: string | null }) {
  const name = name80(o.name)
  if (!name || !name80(o.cn)) throw bad("Give the CA a name and a common name.")
  const parent = o.parentId ? await caRow(c, o.parentId) : null
  const made = await wrap(() =>
    createCa({
      cn: o.cn,
      years: o.years,
      keyKind: o.keyKind,
      parent: parent ? { certPem: parent.certPem, keyPem: unseal(c, parent.keyEnc) } : undefined,
      crlUrl: parent ? crlUrl(parent.id) : undefined,
    })
  )
  const info = certInfo(made.certPem)
  const [row] = await db
    .insert(secretCas)
    .values({ projectId: c.projectId, parentId: parent?.id ?? null, name, certPem: made.certPem, keyEnc: seal(c, made.keyPem), subject: info.subject, notAfter: info.notAfter, createdBy: c.userId || null })
    .returning({ id: secretCas.id })
  await audit("secrets_ca_create", { detail: `${name} (${parent ? `intermediate under ${parent.name}` : "root"})` })
  return row.id
}

export async function deleteCa(c: Ctx, id: string) {
  const r = await caRow(c, id)
  const [kid] = await db.select({ id: secretCas.id }).from(secretCas).where(eq(secretCas.parentId, id)).limit(1)
  if (kid) throw bad("Delete its intermediate CAs first.", 409)
  await db.delete(secretCas).where(eq(secretCas.id, id))
  await audit("secrets_ca_delete", { detail: r.name })
}

// The CA's certificate and everything above it, leaf first.
export async function caChain(c: Ctx, id: string) {
  const out: string[] = []
  let cur: typeof secretCas.$inferSelect | undefined = await caRow(c, id)
  const name = cur.name
  while (cur) {
    out.push(cur.certPem)
    cur = cur.parentId ? await caRow(c, cur.parentId) : undefined
  }
  return { pem: out.join(""), name }
}

export async function addTemplate(c: Ctx, caId: string, o: { name: string; kind: LeafKind; sanPatterns: string[]; maxTtlDays: number }) {
  await caRow(c, caId)
  const name = name80(o.name)
  const pats = o.sanPatterns.map((s) => s.trim()).filter(Boolean)
  if (!name) throw bad("Name the template.")
  if (!pats.length) throw bad("Allow at least one name pattern (use * for any).")
  if (!(o.maxTtlDays >= 1 && o.maxTtlDays <= 3650)) throw bad("Longest lifetime is between 1 and 3650 days.")
  await db.insert(secretCertTemplates).values({ caId, name, kind: o.kind, sanPatterns: pats, maxTtlDays: o.maxTtlDays })
}

export async function deleteTemplate(c: Ctx, caId: string, id: string) {
  await caRow(c, caId)
  await db.delete(secretCertTemplates).where(and(eq(secretCertTemplates.id, id), eq(secretCertTemplates.caId, caId)))
}

export async function issueFromCa(
  c: Ctx,
  caId: string,
  o: { templateId: string; name: string; cn: string; sans: string[]; ttlDays: number; csr?: string; keyKind: KeyKind }
) {
  const ca = await caRow(c, caId)
  const [t] = await db.select().from(secretCertTemplates).where(and(eq(secretCertTemplates.id, o.templateId), eq(secretCertTemplates.caId, caId)))
  if (!t) throw bad("Pick a template.")
  if (!(o.ttlDays >= 1) || o.ttlDays > t.maxTtlDays) throw bad(`This template allows at most ${t.maxTtlDays} days.`)
  const csr = o.csr?.trim() || undefined
  const asked = csr ? await wrap(() => csrNames(csr)) : null
  const cn = (o.cn.trim() || asked?.cn || "").trim()
  const sans = o.sans.map((s) => s.trim()).filter(Boolean)
  const names = sans.length ? sans : (asked?.sans ?? [])
  if (t.kind === "server" && !names.length && cn) names.push(cn)
  if (!cn && !names.length) throw bad("Give a common name or at least one name.")
  for (const n of [...names, ...(t.kind === "server" ? [cn] : [])].filter(Boolean))
    if (!nameAllowed(t.sanPatterns, n)) throw bad(`“${n}” isn't allowed by the template (${t.sanPatterns.join(", ")}).`)
  const made = await wrap(() =>
    issueLeaf({ ca: { certPem: ca.certPem, keyPem: unseal(c, ca.keyEnc) }, kind: t.kind, cn: cn || names[0], sans: names, ttlDays: o.ttlDays, csrPem: csr, keyKind: o.keyKind, crlUrl: crlUrl(ca.id) })
  )
  const info = certInfo(made.certPem)
  const chain = (await caChain(c, caId)).pem
  const [row] = await db
    .insert(secretCerts)
    .values({ projectId: c.projectId, name: name80(o.name) || info.cn, source: "ca", certPem: made.certPem, chainPem: chain, keyEnc: made.keyPem ? seal(c, made.keyPem) : null, ...fields(info), caId, createdBy: c.userId || null })
    .returning()
  await audit("secrets_cert_issue", { detail: `${row.name} from ${ca.name} (${t.name}, ${o.ttlDays} days)` })
  return card(row)
}

// The CRL for a CA, signed now. Public: relying parties fetch it without signing in.
export async function crlFor(caId: string) {
  const [ca] = await db.select().from(secretCas).where(eq(secretCas.id, caId))
  if (!ca) return null
  const rows = await db.select({ serial: secretCerts.serial, at: secretCerts.revokedAt, reason: secretCerts.revokeReason }).from(secretCerts).where(and(eq(secretCerts.caId, caId), isNotNull(secretCerts.revokedAt)))
  const c = await systemCtx(ca.projectId)
  if (!c) return null
  return buildCrl({ ca: { certPem: ca.certPem, keyPem: unseal(c, ca.keyEnc) }, revoked: rows.map((r) => ({ serial: r.serial, at: r.at!, reason: r.reason ?? undefined })) })
}

// For the search box: names only.
export async function certNames(c: Ctx, q: string) {
  const rows = await db.select({ id: secretCerts.id, name: secretCerts.name, subject: secretCerts.subject }).from(secretCerts).where(eq(secretCerts.projectId, c.projectId)).orderBy(desc(secretCerts.createdAt))
  const n = q.toLowerCase()
  return rows.filter((r) => r.name.toLowerCase().includes(n)).slice(0, 20)
}

