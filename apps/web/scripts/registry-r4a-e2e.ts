// R4a check against the live dev stack (registry on REGISTRY_DOMAIN, dev Postgres, Redis).
// Run: node --require $STUB --env-file=.env.local --import tsx scripts/registry-r4a-e2e.ts
// Makes users' tokens and a few repos under crtest, then removes them again.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import { and, eq, inArray, like } from "drizzle-orm"

import { encrypt } from "../lib/crypto.ts"
import { db } from "../lib/db/index.ts"
import { registryEvents, registryNamespaces, registryOrgMembers, registryRepoAliases, registryRepos, registryTokenRepos, registryTokens, registryTags } from "../lib/db/schema.ts"
import { applyPolicy } from "../lib/registry/policy.ts"
import { listEvents } from "../lib/registry/activity.ts"
import * as admin from "../lib/registry/repo-admin.ts"
import { newToken } from "../lib/registry/rules.ts"

const HOST = `http://${process.env.REGISTRY_DOMAIN}`
const U1 = "3t1TX7qzH4GiC7yZE50czBlruAVWWOQl" // crtest
const U2 = "bSxNEYhihSAHZfNy1ICCr6GpCGbUd6fw" // crother
const U2_EMAIL = "sakshammaxwell1891@gmail.com"
const ORG = "68f2fc04-abe0-4c53-b37a-7f3a5dfc1adb" // r1b-acme, owner q60…
const ORG_OWNER = "q60pMMJNFZLzbK1EFSaeHgJhuUmgyf87"

const made: string[] = []
async function token(userId: string, access: "pull" | "push" | "delete", repoIds?: string[]) {
  const t = newToken()
  const [row] = await db.insert(registryTokens).values({ userId, name: "r4a-e2e", prefix: t.prefix, secretEnc: encrypt(t.secret), access, allRepos: !repoIds }).returning({ id: registryTokens.id })
  if (repoIds) await db.insert(registryTokenRepos).values(repoIds.map((repoId) => ({ tokenId: row.id, repoId })))
  made.push(row.id)
  return t.token
}

const call = (tok: string, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) =>
  fetch(HOST + path, { method, body, headers: { authorization: "Basic " + Buffer.from(`x:${tok}`).toString("base64"), ...headers } })

const sha = (b: Uint8Array | string) => "sha256:" + createHash("sha256").update(b).digest("hex")
const OCI = "application/vnd.oci.image.manifest.v1+json"

// Pushes a one-layer image under name:tag. Returns the manifest PUT status.
async function push(tok: string, name: string, tag: string, description?: string) {
  const cfg = JSON.stringify({ architecture: "amd64", os: "linux", rootfs: { type: "layers", diff_ids: [] }, config: description ? { Labels: { "org.opencontainers.image.description": description } } : {} })
  const layer = Buffer.from(`layer ${Math.random()}`)
  for (const blob of [cfg, layer]) {
    const r = await call(tok, "POST", `/v2/${name}/blobs/uploads/?digest=${sha(blob)}`, blob, { "content-type": "application/octet-stream" })
    if (r.status !== 201) return r.status
  }
  const m = JSON.stringify({ schemaVersion: 2, mediaType: OCI, config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha(cfg), size: cfg.length }, layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: sha(layer), size: layer.length }] })
  const r = await call(tok, "PUT", `/v2/${name}/manifests/${tag}`, m, { "content-type": OCI })
  if (r.status !== 201) console.log("   push body:", await r.text())
  return r.status
}
const pull = async (tok: string, name: string, tag: string) => (await call(tok, "GET", `/v2/${name}/manifests/${tag}`, undefined, { accept: OCI })).status
const del = async (tok: string, name: string, tag: string) => (await call(tok, "DELETE", `/v2/${name}/manifests/${tag}`)).status

const step = (s: string) => console.log("-", s)
const repoRow = async (id: string) => (await db.select().from(registryRepos).where(eq(registryRepos.id, id)))[0]

async function main() {
  const [crtest] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.name, "crtest"))
  const [acme] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.name, "r1b-acme"))
  const ownerPush = await token(U1, "push")
  const ownerDelete = await token(U1, "delete")
  const otherPull = await token(U2, "pull")
  const otherPush = await token(U2, "push")
  const otherDelete = await token(U2, "delete")

  step("create on push with a delete token; description from the label; events")
  assert.equal(await push(ownerDelete, "crtest/r4a-e2e", "v1", "hello from the label"), 201)
  const [repo] = await db.select().from(registryRepos).where(and(eq(registryRepos.namespaceId, crtest.id), eq(registryRepos.name, "r4a-e2e")))
  assert.equal(repo.description, "hello from the label")
  const ev = await listEvents({ repoId: repo.id })
  assert.ok(ev.some((e) => e.action === "repo_create") && ev.some((e) => e.action === "push"), JSON.stringify(ev.map((e) => e.action)))
  assert.equal(await pull(ownerPush, "crtest/r4a-e2e", "v1"), 200)
  assert.ok((await listEvents({ repoId: repo.id })).some((e) => e.action === "token_use"))

  step("push-only token can't delete, push+delete can")
  assert.equal(await del(ownerPush, "crtest/r4a-e2e", "v1"), 403)
  assert.equal(await del(ownerDelete, "crtest/r4a-e2e", "v1"), 202)
  assert.equal(await push(ownerPush, "crtest/r4a-e2e", "v1"), 201)

  step("custom description sticks, reset goes back to the label")
  assert.equal((await admin.setDescription(U1, repo.id, "typed by hand")).error, undefined)
  await push(ownerPush, "crtest/r4a-e2e", "v2", "label again")
  assert.equal((await repoRow(repo.id)).description, "typed by hand")
  await admin.setDescription(U1, repo.id, null)
  assert.equal((await repoRow(repo.id)).description, "label again")

  step("collaborators: none -> 404, read pulls not pushes, write pushes, delete scope needed to delete")
  assert.equal(await pull(otherPull, "crtest/r4a-e2e", "v1"), 404)
  assert.match((await admin.addCollaborator(U2, repo.id, U2_EMAIL, "read")).error ?? "", /exist/)
  assert.equal((await admin.addCollaborator(U1, repo.id, "nobody@example.invalid", "read")).error, "No member of this Nimbus has that email.")
  assert.deepEqual(await admin.addCollaborator(U1, repo.id, U2_EMAIL, "read"), {})
  assert.equal(await pull(otherPull, "crtest/r4a-e2e", "v1"), 200)
  assert.match((await admin.addCollaborator(U2, repo.id, U2_EMAIL, "admin")).error ?? "", /admin access/)
  assert.equal(await push(otherPush, "crtest/r4a-e2e", "c1"), 403)
  assert.deepEqual(await admin.setCollaboratorRole(U1, repo.id, U2, "write"), {})
  assert.equal(await push(otherPush, "crtest/r4a-e2e", "c1"), 201)
  assert.equal(await del(otherPush, "crtest/r4a-e2e", "c1"), 403)
  assert.equal(await del(otherDelete, "crtest/r4a-e2e", "c1"), 202)
  assert.equal((await admin.listCollaborators(repo.id)).length, 1)
  assert.deepEqual(await admin.removeCollaborator(U1, repo.id, U2), {})
  assert.equal(await pull(otherPull, "crtest/r4a-e2e", "v1"), 404)

  step("rename: old name pulls, push refused with the new path, scoped token survives, alias expiry -> 404")
  const scoped = await token(U1, "push", [repo.id])
  const r = await admin.renameRepo(U1, repo.id, { namespace: "crtest", name: "r4a-e2e-new" })
  assert.equal(r.fullName, "crtest/r4a-e2e-new", r.error)
  assert.equal(await pull(ownerPush, "crtest/r4a-e2e", "v1"), 200)
  assert.equal(await pull(ownerPush, "crtest/r4a-e2e-new", "v1"), 200)
  assert.equal(await push(ownerPush, "crtest/r4a-e2e", "late"), 403)
  const msg = await (await call(ownerPush, "POST", "/v2/crtest/r4a-e2e/blobs/uploads/")).json()
  assert.match(msg.errors[0].message, /moved to crtest\/r4a-e2e-new/)
  assert.equal(await del(ownerDelete, "crtest/r4a-e2e", "v1"), 403)
  assert.equal(await push(scoped, "crtest/r4a-e2e-new", "scoped"), 201)
  assert.equal((await admin.aliasFor(repo.id))?.fullName, "crtest/r4a-e2e")
  assert.match((await admin.renameRepo(U1, repo.id, { namespace: "crtest", name: "r4a-e2e-new" })).error ?? "", /already its name/)
  assert.match((await admin.renameRepo(U1, repo.id, { namespace: "crother", name: "x" })).error ?? "", /namespaces you own/)
  await db.update(registryRepoAliases).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(registryRepoAliases.repoId, repo.id))
  assert.equal(await pull(ownerPush, "crtest/r4a-e2e", "v1"), 404)
  assert.equal(await admin.purgeAliases() >= 1, true)
  assert.ok((await listEvents({ repoId: repo.id })).some((e) => e.action === "rename"))

  step("archive: push and delete refused, pull ok, policy skips it")
  await db.update(registryRepos).set({ policy: { deletePattern: "*" } }).where(eq(registryRepos.id, repo.id))
  assert.deepEqual(await admin.setArchived(U1, repo.id, true), {})
  assert.equal(await push(ownerPush, "crtest/r4a-e2e-new", "arch"), 403)
  assert.equal(await del(ownerDelete, "crtest/r4a-e2e-new", "v1"), 403)
  assert.equal(await pull(ownerPush, "crtest/r4a-e2e-new", "v1"), 200)
  assert.deepEqual(await applyPolicy(repo.id), { tags: [], untagged: [] })
  assert.deepEqual(await admin.setArchived(U1, repo.id, false), {})
  assert.ok((await applyPolicy(repo.id)).tags.length > 0)

  step("team write pushes")
  const [t] = await db.insert(registryRepos).values({ namespaceId: acme.id, name: "r4a-team" }).returning()
  await db.insert(registryOrgMembers).values({ orgId: ORG, userId: U2, role: "read" })
  assert.equal(await push(otherPush, "r1b-acme/r4a-team", "t1"), 403)
  const team = await admin.createTeam(ORG_OWNER, ORG, "r4a-team")
  assert.ok(team.id, team.error)
  assert.match((await admin.createTeam(U1, ORG, "x")).error ?? "", /org owner/)
  assert.deepEqual(await admin.addTeamMember(ORG_OWNER, team.id!, U2), {})
  assert.deepEqual(await admin.setTeamRepo(ORG_OWNER, team.id!, t.id, "write"), {})
  assert.equal((await admin.teamsForRepo(t.id))[0].role, "write")
  assert.equal(await push(otherPush, "r1b-acme/r4a-team", "t1"), 201)
  assert.equal((await admin.listTeams(ORG))[0].members.length, 1)
  assert.deepEqual(await admin.setTeamRepo(ORG_OWNER, team.id!, t.id, null), {})
  assert.equal(await push(otherPush, "r1b-acme/r4a-team", "t2"), 403)
  assert.deepEqual(await admin.deleteTeam(ORG_OWNER, team.id!), {})
  assert.ok((await listEvents({ namespaceId: acme.id })).some((e) => e.action === "team_create"))

  await cleanup(t.id, repo.id)
  console.log("R4a e2e passed")
}

async function cleanup(...repoIds: string[]) {
  await db.delete(registryOrgMembers).where(and(eq(registryOrgMembers.orgId, ORG), eq(registryOrgMembers.userId, U2)))
  if (repoIds.length) {
    await db.delete(registryEvents).where(inArray(registryEvents.repoId, repoIds))
    await db.delete(registryRepos).where(inArray(registryRepos.id, repoIds))
  }
  await db.delete(registryTokens).where(inArray(registryTokens.id, made))
  await db.delete(registryTokens).where(like(registryTokens.name, "r4a-e2e"))
}

main()
  .catch(async (e) => {
    console.error(e)
    const rows = await db.select({ id: registryRepos.id }).from(registryRepos).where(inArray(registryRepos.name, ["r4a-e2e", "r4a-e2e-new", "r4a-team"]))
    await cleanup(...rows.map((r) => r.id)).catch(() => {})
    process.exitCode = 1
  })
  .finally(() => setTimeout(() => process.exit(), 200))
