/* eslint-disable @typescript-eslint/no-explicit-any */
// Exercises /api/v1 over HTTP with bearer tokens, one real happy path per route
// group, plus the refusals: signed-out 401, someone else's private file, and a
// pending or temporary-password account 403. Cleans up what it makes.
//
//   cd apps/web && node --env-file=.env.local scripts/api-check.ts
//
// Needs a running Nimbus (API_URL, default http://localhost:3000) with tusd, and
// the test accounts: API_EMAIL / API_EMAIL2, password API_PASSWORD.
import { createHash, createHmac, randomBytes } from "node:crypto"

import postgres from "postgres"

const BASE = process.env.API_URL ?? "http://localhost:3000"
const A_EMAIL = process.env.API_EMAIL ?? "browser-test@example.invalid"
const B_EMAIL = process.env.API_EMAIL2 ?? "newbie@example.invalid"
const PASSWORD = process.env.API_PASSWORD ?? "browser-test-pass-123"
const RUN = `api-check-${Date.now().toString(36)}`
const sql = postgres(process.env.DATABASE_URL!)

let failures = 0
let passes = 0
const check = (name: string, ok: unknown, detail?: unknown) => {
  if (ok) {
    passes++
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(
      `  FAIL ${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)?.slice(0, 300)}`}`
    )
  }
}
const group = async (name: string, fn: () => Promise<void>) => {
  console.log(`\n${name}`)
  try {
    await fn()
  } catch (e) {
    failures++
    console.log(`  FAIL ${name} threw: ${(e as Error).message}`)
  }
}

type Res<T = any> = { status: number; body: T; headers: Headers }
async function call<T = any>(
  tok: string | null,
  method: string,
  path: string,
  body?: unknown
): Promise<Res<T>> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  return { status: res.status, body: parsed, headers: res.headers }
}

async function signIn(email: string, password = PASSWORD) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: "nimbus://", "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  const tok = res.headers.get("set-auth-token")
  if (!tok) throw new Error(`Couldn't sign in ${email}: ${res.status}`)
  return tok
}

const auth = (tok: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}/api/auth${path}`, {
    method,
    headers: {
      origin: "nimbus://",
      authorization: `Bearer ${tok}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// RFC 6238, for the two-factor check.
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const c of secret.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0")
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const h = createHmac("sha1", key).update(counter).digest()
  const o = h[19] & 15
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, "0")
}

// A tus upload over plain HTTP; returns the upload's URL.
async function tusUpload(
  tusUrl: string,
  data: Uint8Array,
  meta: Record<string, string>
) {
  const enc = Object.entries(meta)
    .map(([k, v]) => `${k} ${Buffer.from(v).toString("base64")}`)
    .join(",")
  const created = await fetch(tusUrl, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(data.length),
      "Upload-Metadata": enc,
    },
  })
  if (created.status !== 201)
    throw new Error(`tus create ${created.status}: ${await created.text()}`)
  const url = new URL(created.headers.get("location")!, tusUrl).href
  const sent = await fetch(url, {
    method: "PATCH",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": "0",
      "Content-Type": "application/offset+octet-stream",
    },
    body: data as BodyInit,
  })
  if (sent.status !== 204)
    throw new Error(`tus patch ${sent.status}: ${await sent.text()}`)
  return url
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
const cleanup: (() => Promise<unknown>)[] = []

async function main() {
  const A = await signIn(A_EMAIL)
  const B = await signIn(B_EMAIL)
  const me: any = (await call(A, "GET", "/me")).body
  const meB: any = (await call(B, "GET", "/me")).body
  let instance: any

  await group("instance, me, signed-out", async () => {
    const r = await call(null, "GET", "/instance")
    instance = r.body
    check("GET /instance has the server version", typeof r.body.version === "string", r.body.version)
    check("GET /instance is public", r.status === 200 && r.body.app === "nimbus" && typeof r.body.tusUrl === "string")
    check("GET /me", me.id && me.gate === null && me.usage && me.uploadSpeedBytes !== undefined, me)
    for (const [m, p] of [
      ["GET", "/files"],
      ["GET", "/tags"],
      ["POST", "/folders"],
      ["GET", "/account"],
      ["GET", "/vaults"],
      ["POST", "/push"],
      ["GET", "/events"],
    ] as const) {
      const x = await call(null, m, p, m === "POST" ? {} : undefined)
      check(`${m} ${p} without a token is 401`, x.status === 401 && x.body?.error === "signed-out", x)
    }
    const bad = await call("not-a-token", "GET", "/files")
    check("a bad token is 401", bad.status === 401)
  })

  // ---- files, folders, lists
  let folderId = ""
  let folder2Id = ""
  let fileId = ""
  let versionIds: string[] = []
  const bytes1 = randomBytes(2048)
  const bytes2 = randomBytes(3000)
  await group("folders, upload, lists, file operations", async () => {
    const f = await call(A, "POST", "/folders", { parentId: null, name: RUN })
    folderId = f.body?.id
    check("create folder", f.status === 200 && folderId, f)
    cleanup.push(async () => {
      await call(A, "POST", "/items/trash", { ids: [folderId, folder2Id].filter(Boolean) })
      await call(A, "POST", "/items/delete", { ids: [folderId, folder2Id].filter(Boolean) })
    })
    const dup = await call(A, "POST", "/folders", { parentId: null, name: RUN })
    check("duplicate folder name is refused", dup.status === 400 && dup.body.message, dup)
    const f2 = await call(A, "POST", "/folders", { parentId: folderId, name: "inner" })
    folder2Id = f2.body?.id
    check("create inner folder", folder2Id, f2)
    check("bad input is 400", (await call(A, "POST", "/folders", { name: 5 })).status === 400)

    const contents = await call(A, "GET", `/folders/${folderId}`)
    check(
      "folder contents with breadcrumbs",
      contents.body.items.length === 1 &&
        contents.body.path.at(-1).id === folderId &&
        contents.body.folder.role === "owner",
      contents.body
    )
    check("GET /files lists it", (await call(A, "GET", "/files?limit=1000")).body.items.some((i: any) => i.id === folderId))

    // upload: plan -> tus -> finish
    const plan = await call(A, "POST", "/uploads/plan", {
      parentId: folderId,
      entries: [{ path: "a.txt", size: bytes1.length }],
    })
    check("plan upload", plan.status === 200 && plan.body.token && !plan.body.error, plan.body)
    const url1 = await tusUpload(instance.tusUrl, bytes1, {
      filename: "a.txt",
      filetype: "text/plain",
      token: plan.body.token,
      path: "a.txt",
      onConflict: "rename",
    })
    const fin = await call(A, "POST", "/uploads/finish", { uploadUrl: url1, sha256: sha(bytes1) })
    fileId = fin.body?.nodeId
    check("finish upload", fin.status === 200 && fileId && fin.body.versionId, fin)
    const again = await call(A, "POST", "/uploads/finish", { uploadUrl: url1 })
    check("finish is idempotent", again.body?.nodeId === fileId, again)

    const plan2 = await call(A, "POST", "/uploads/plan", {
      parentId: folderId,
      entries: [{ path: "a.txt", size: 10 }, { path: "bad/..", size: 1 }],
    })
    check(
      "same name is a conflict with a Keep-both name; bad path rejected",
      plan2.body.conflicts?.[0]?.path === "a.txt" &&
        plan2.body.conflicts[0].freeName === "a (1).txt" &&
        plan2.body.rejected.length === 1,
      plan2.body
    )
    const ex = await call(A, "POST", "/uploads/exists", {
      items: [
        { sha256: sha(bytes1) },
        { sha256: sha(randomBytes(8)), name: "a.txt", size: bytes1.length, parentId: folderId },
        { name: "nope.txt", parentId: folderId },
      ],
    })
    check(
      "exists by hash, by name, and not at all",
      ex.body.matches?.[0]?.id === fileId &&
        ex.body.matches[0].by === "sha256" &&
        ex.body.matches[1]?.by === "name" &&
        ex.body.matches[1].sameSize === true &&
        ex.body.matches[2] === null,
      ex.body
    )
    const dir = await call(A, "POST", "/uploads/folders", { parentId: folderId, paths: ["empty/deep"] })
    check("create empty folders", dir.status === 200, dir)

    // thumbnail the way the browser sends it, over the existing route
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)])
    const th = await fetch(`${BASE}/api/files/${fileId}/thumb?v=${fin.body.versionId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${A}` },
      body: webp,
    })
    check("POST /api/files/{id}/thumb with a bearer", th.status === 200 && (await th.json()).thumb !== undefined, th.status)
    const got = await fetch(`${BASE}/api/files/${fileId}/thumb?v=${fin.body.versionId}`, {
      headers: { authorization: `Bearer ${A}` },
    })
    check("GET /api/files/{id}/thumb with a bearer", got.status === 200 && got.headers.get("content-type") === "image/webp", got.status)

    const dl = await fetch(`${BASE}/api/files/${fileId}/download`, {
      headers: { authorization: `Bearer ${A}` },
      redirect: "manual",
    })
    check("GET /api/files/{id}/download with a bearer redirects", dl.status === 302, dl.status)
    const z = await fetch(`${BASE}/api/zip`, {
      method: "POST",
      headers: { authorization: `Bearer ${A}` },
      body: new URLSearchParams({ ids: fileId }),
    })
    check("POST /api/zip with a bearer", z.status === 200 && (await z.arrayBuffer()).byteLength > 100, z.status)
    const man = await call(A, "POST", "/zip-manifest", { ids: [folderId] })
    check("zip manifest", man.body.entries?.some((e: any) => e.path.endsWith("a.txt")), man.body)

    const idx = await call(A, "PUT", `/items/${fileId}/content`, {
      versionId: fin.body.versionId,
      body: "zebra crossing unique-api-check-word",
      source: "text",
    })
    check("save search text", idx.status === 200, idx)

    // item operations
    const ren = await call(A, "PATCH", `/items/${fileId}`, { name: "renamed.txt" })
    check("rename", ren.status === 200, ren)
    const mv = await call(A, "POST", "/items/move", { ids: [fileId], parentId: folder2Id })
    check("move", mv.status === 200, mv)
    const mvBad = await call(A, "POST", "/items/move", { ids: [folderId], parentId: folder2Id })
    check("a folder can't move inside itself", mvBad.status === 400 && /itself/.test(mvBad.body.message), mvBad)
    const det = await call(A, "GET", `/items/${fileId}`)
    check("details", det.body.details?.location?.join("/") === `My files/${RUN}/inner` && det.body.item.name === "renamed.txt", det.body)
    const pick = await call(A, "GET", `/picker?parent=${folderId}`)
    check("folder picker", pick.body.folders?.some((x: any) => x.id === folder2Id), pick.body)

    check("star", (await call(A, "POST", "/items/star", { ids: [fileId], starred: true })).status === 200)
    check("starred list", (await call(A, "GET", "/starred")).body.items.some((i: any) => i.id === fileId))
    await call(A, "POST", "/items/star", { ids: [fileId], starred: false })
    const rec = await call(A, "GET", `/items/${fileId}/preview?open=1`)
    check("preview url", rec.status === 200 && rec.body.url.startsWith("http"), rec)
    const body = await fetch(rec.body.url)
    check("preview url serves the bytes", Buffer.from(await body.arrayBuffer()).equals(bytes1), body.status)
    check("recent lists an opened file", (await call(A, "GET", "/recent")).body.items.some((i: any) => i.id === fileId))
    const office = await call(A, "GET", `/items/${fileId}/office`)
    check("office frame answers (null without Collabora)", office.status === 200 && "office" in office.body, office)

    const filt = await call(A, "GET", `/folders/${folder2Id}?type=doc&size=small&modified=today&sort=size&order=desc&limit=1`)
    check("filters, sort and paging", filt.status === 200 && filt.body.items.length === 1 && filt.body.total === 1 && filt.body.nextCursor === null, filt.body)
    const none = await call(A, "GET", `/folders/${folder2Id}?type=image`)
    check("a filter can match nothing", none.body.total === 0)
    check("bad filter is 400", (await call(A, "GET", "/files?type=banana")).status === 400)
    const pg = await call(A, "GET", `/folders/${folderId}?limit=1`)
    check("paging gives a cursor", pg.body.nextCursor === "1" && pg.body.total === 2, pg.body)

    // trash, restore, delete
    check("trash", (await call(A, "POST", "/items/trash", { ids: [fileId] })).status === 200)
    const tr = await call(A, "GET", "/trash")
    check("trash list", tr.body.items.some((i: any) => i.id === fileId) && "retentionDays" in tr.body)
    check("restore", (await call(A, "POST", "/items/restore", { ids: [fileId] })).status === 200)
    check("restored file is back", (await call(A, "GET", `/folders/${folder2Id}`)).body.items.some((i: any) => i.id === fileId))
    check("delete refuses what isn't trashed", (await call(A, "POST", "/items/delete", { ids: [fileId] })).status === 200 && (await call(A, "GET", `/items/${fileId}`)).status === 200)
  })

  // ---- versions
  await group("versions", async () => {
    const plan = await call(A, "POST", "/uploads/plan", { parentId: folder2Id, entries: [{ path: "renamed.txt", size: bytes2.length }] })
    const url = await tusUpload(instance.tusUrl, bytes2, {
      filename: "renamed.txt",
      filetype: "text/plain",
      token: plan.body.token,
      path: "renamed.txt",
      onConflict: "version",
    })
    const fin = await call(A, "POST", "/uploads/finish", { uploadUrl: url })
    check("same-name upload with onConflict=version adds a version", fin.body.nodeId === fileId, fin.body)
    const v = await call(A, "GET", `/items/${fileId}/versions`)
    versionIds = v.body.versions.map((x: any) => x.id)
    check("list versions", v.body.versions.length === 2 && v.body.versions[0].current, v.body)
    const old = v.body.versions[1].id
    const cur = v.body.versions[0].id
    check("note and keep", (await call(A, "PATCH", `/versions/${old}`, { note: "first", keep: true })).status === 200)
    check("note too long is refused", (await call(A, "PATCH", `/versions/${old}`, { note: "x".repeat(300) })).status === 400)
    check("make current", (await call(A, "POST", `/versions/${old}/current`)).status === 200)
    check("a current version can't be deleted", (await call(A, "DELETE", `/versions/${old}`)).status === 400)
    const cp = await call(A, "POST", `/versions/${cur}/copy`)
    check("copy a version", /\(v2\)/.test(cp.body.name), cp)
    await call(A, "POST", `/versions/${cur}/current`)
    const older = await call(A, "DELETE", `/items/${fileId}/versions`)
    check("delete older keeps kept versions", older.body.count === 0, older)
    await call(A, "PATCH", `/versions/${old}`, { keep: false })
    const older2 = await call(A, "DELETE", `/items/${fileId}/versions`)
    check("delete older", older2.body.count === 1, older2)
  })

  // ---- tags
  await group("tags", async () => {
    const c = await call(A, "POST", "/tags", { name: RUN, color: "teal", applyTo: [fileId] })
    const tagId = c.body?.tag?.id
    check("create tag and apply", tagId, c)
    cleanup.push(() => call(A, "DELETE", `/tags/${tagId}`))
    const t = await call(A, "GET", `/tags/${tagId}`)
    check("items by tag", t.body.items?.[0]?.id === fileId && t.body.count === 1, t.body)
    check("tag filter", (await call(A, "GET", `/folders/${folder2Id}?tag=${tagId}`)).body.total === 1)
    check("rename tag", (await call(A, "PATCH", `/tags/${tagId}`, { name: `${RUN} b` })).status === 200)
    check("recolor tag", (await call(A, "PATCH", `/tags/${tagId}`, { color: "red" })).status === 200)
    const other = await call(A, "POST", "/tags", { name: `${RUN} other`, color: "blue" })
    const otherId = other.body.tag.id
    const clash = await call(A, "PATCH", `/tags/${otherId}`, { name: `${RUN} b` })
    check("renaming onto another tag offers a merge", clash.body.merge === tagId, clash.body)
    check("merge tags", (await call(A, "POST", `/tags/${otherId}/merge`, { into: tagId })).status === 200)
    check("remove tag from item", (await call(A, "POST", "/tags/apply", { ids: [fileId], tagId, on: false })).status === 200)
    await call(A, "POST", "/tags/apply", { ids: [fileId], tagId, on: true })
    const del = await call(A, "DELETE", `/tags/${tagId}`)
    check("delete tag returns a snapshot", del.body.tag?.id === tagId && del.body.nodeIds.includes(fileId), del.body)
    const back = await call(A, "POST", "/tags/restore", del.body)
    check("restore tag", back.status === 200 && (await call(A, "GET", `/tags/${tagId}`)).body.count === 1, back)
    check("someone else's tag is not found", (await call(B, "GET", `/tags/${tagId}`)).status === 404)
  })

  // ---- search
  await group("search", async () => {
    const q = await call(A, "GET", "/search?q=renamed&quick=1")
    check("quick search", q.body.items?.some((i: any) => i.id === fileId), q.body)
    const cur = (await call(A, "GET", `/items/${fileId}/versions`)).body.versions.find((v: any) => v.current)
    await call(A, "PUT", `/items/${fileId}/content`, { versionId: cur.id, body: "zebra crossing unique-api-check-word", source: "text" })
    const full = await call(A, "GET", "/search?q=unique-api-check-word&type=doc")
    check("full search finds file text, with filters", full.body.items?.[0]?.id === fileId && full.body.items[0].snippet, full.body)
    const browse = await call(A, "GET", "/search?type=doc&limit=1000")
    check("a filter with no text lists matches", browse.body.items?.some((i: any) => i.id === fileId) && browse.body.items.every((i: any) => !i.snippet), browse.body)
    check("...with where it is", typeof browse.body.items?.[0]?.where === "string", browse.body)
    check("...and no filter and no text finds nothing", (await call(A, "GET", "/search")).body.items?.length === 0)
    check("search langs", typeof (await call(A, "GET", "/search/langs")).body.langs === "string")
  })

  // ---- sharing, and another member's access
  await group("sharing", async () => {
    check("another member can't open a private file", (await call(B, "GET", `/items/${fileId}`)).status === 404)
    check("...nor its preview", (await call(B, "GET", `/items/${fileId}/preview`)).status === 404)
    check("...nor its versions", (await call(B, "GET", `/items/${fileId}/versions`)).body.versions.length === 0)
    check("...nor its folder", (await call(B, "GET", `/folders/${folderId}`)).status === 404)
    check("...nor rename it", (await call(B, "PATCH", `/items/${fileId}`, { name: "x" })).status === 403)
    check("...nor trash it", (await call(B, "POST", "/items/trash", { ids: [fileId] })).status === 403)
    check("...nor share it", (await call(B, "POST", `/items/${fileId}/shares`, { target: me.id, role: "viewer" })).status === 403)
    check("...nor its share state", (await call(B, "GET", `/items/${fileId}/shares`)).status === 404)
    await call(B, "PUT", `/items/${fileId}/content`, { versionId: versionIds[0], body: "intruder-word", source: "text" })
    check("...nor index text into it", !(await call(A, "GET", "/search?q=intruder-word")).body.items.length)
    const dl = await fetch(`${BASE}/api/files/${fileId}/download`, { headers: { authorization: `Bearer ${B}` }, redirect: "manual" })
    check("...nor download it", dl.status === 404, dl.status)

    const mem = await call(A, "GET", `/members?q=${encodeURIComponent(B_EMAIL.slice(0, 6))}`)
    check("find members", mem.body.members?.some((m: any) => m.id === meB.id), mem.body)
    const sh = await call(A, "POST", `/items/${folderId}/shares`, { target: meB.id, role: "viewer" })
    check("share with a member", sh.status === 200, sh)
    cleanup.push(async () => {
      const s = (await call(A, "GET", `/items/${folderId}/shares`)).body
      for (const p of s?.people ?? []) await call(A, "DELETE", `/shares/${p.shareId}`)
      for (const l of s?.links ?? []) await call(A, "DELETE", `/links/${l.id}`)
      await call(A, "DELETE", `/items/${folderId}/ownership`)
    })
    const state = await call(A, "GET", `/items/${folderId}/shares`)
    const person = state.body.people.find((p: any) => p.userId === meB.id)
    check("share state", person && state.body.isOwner && "publicLinks" in state.body, state.body)
    check("B sees it in Shared with me", (await call(B, "GET", "/shared")).body.items.some((i: any) => i.id === folderId))
    const inB = await call(B, "GET", `/folders/${folder2Id}`)
    check("B reads inside the shared folder as viewer", inB.body.folder?.role === "viewer" && inB.body.items.some((i: any) => i.id === fileId), inB.body)
    check("B's breadcrumb starts at the shared folder", inB.body.path[0].id === folderId, inB.body.path)
    check("viewer can't rename", (await call(B, "PATCH", `/items/${fileId}`, { name: "no" })).status === 403)
    check("viewer can't create inside", (await call(B, "POST", "/folders", { parentId: folderId, name: "no" })).status === 404)
    check("viewer can read previews", (await call(B, "GET", `/items/${fileId}/preview`)).status === 200)
    check("viewer can't see versions", (await call(B, "GET", `/items/${fileId}/versions`)).body.versions.length === 0)
    check("B adds a shortcut", (await call(B, "POST", "/shortcuts", { nodeId: folderId })).status === 200 && (await call(B, "GET", "/files")).body.items.some((i: any) => i.shortcut))
    check("B removes the shortcut", (await call(B, "DELETE", `/shortcuts/${folderId}`)).status === 200)
    check("role change", (await call(A, "PATCH", `/shares/${person.shareId}`, { role: "editor" })).status === 200)
    check("editor may rename", (await call(B, "PATCH", `/items/${fileId}`, { name: "renamed.txt" })).status === 200)
    check("editor sees versions", (await call(B, "GET", `/items/${fileId}/versions`)).body.versions.length >= 1)
    check("reshare flag", (await call(A, "PATCH", `/items/${folderId}/shares`, { allowReshare: true })).status === 200)
    check("only the owner sets reshare", (await call(B, "PATCH", `/items/${folderId}/shares`, { allowReshare: false })).status === 403)
    await call(A, "PATCH", `/items/${folderId}/shares`, { allowReshare: false })

    const ln = await call(A, "POST", `/items/${folderId}/links`, { name: "api check", password: "abcd" })
    if (ln.status === 400) check("links are off here (admin setting)", /off|password/.test(ln.body.message), ln.body)
    else {
      const linkId = ln.body.id
      check("create link", linkId, ln)
      const up = await call(A, "PATCH", `/links/${linkId}`, { name: "renamed link", allowDownload: false, expiresAt: new Date(Date.now() + 864e5).toISOString() })
      check("update link", up.status === 200, up)
      check("a link must show or take files", (await call(A, "PATCH", `/links/${linkId}`, { allowView: false, allowUpload: false })).status === 400)
      check("link events", Array.isArray((await call(A, "GET", `/links/${linkId}/events?limit=5`)).body.events))
      check("another member can't touch the link", (await call(B, "DELETE", `/links/${linkId}`)).status === 403)
      check("delete link", (await call(A, "DELETE", `/links/${linkId}`)).status === 200)
    }

    check("offer ownership", (await call(A, "POST", `/items/${folderId}/ownership`, { to: meB.id })).status === 200)
    const nb = await call(B, "GET", "/notifications")
    check("B is told about the offer", nb.body.items.some((n: any) => n.kind === "transfer" && n.pending), nb.body.items?.slice(0, 2))
    check("cancel the offer", (await call(A, "DELETE", `/items/${folderId}/ownership`)).status === 200)
    check("answering a withdrawn offer is 404", (await call(B, "POST", `/items/${folderId}/ownership/answer`, { accept: true })).status === 404)
    check("remove access", (await call(A, "DELETE", `/shares/${person.shareId}`)).status === 200)
    check("B no longer sees it", (await call(B, "GET", `/folders/${folderId}`)).status === 404)
  })

  // ---- notifications
  await group("notifications", async () => {
    const n = await call(B, "GET", "/notifications")
    check("list with counts", Array.isArray(n.body.items) && typeof n.body.unread === "number" && typeof n.body.shared === "number", n.body)
    const id = n.body.items.find((x: any) => !x.read)?.id
    check("mark one read", id ? (await call(B, "POST", "/notifications/read", { ids: [id] })).status === 200 : true)
    check("shared seen", (await call(B, "POST", "/notifications/shared-seen")).status === 200)
    check("mark all read", (await call(B, "POST", "/notifications/read", {})).status === 200)
    check("unread is zero", (await call(B, "GET", "/notifications")).body.unread === 0)
    const legacy = await fetch(`${BASE}/api/notifications`, { headers: { authorization: `Bearer ${B}` } })
    check("GET /api/notifications with a bearer", legacy.status === 200)
  })

  // ---- account
  await group("account", async () => {
    const a = await call(A, "GET", "/account")
    check("account", a.body.profile?.email === A_EMAIL && Array.isArray(a.body.notificationPrefs) && a.body.hasPassword, a.body)
    const before = a.body
    const prefs = { shared: { email: false, bell: true } }
    check("notification prefs", (await call(A, "PUT", "/account/notification-prefs", { prefs })).status === 200)
    check("prefs stuck", (await call(A, "GET", "/account")).body.notificationPrefs.find((p: any) => p.kind === "shared").email === false)
    const old = before.notificationPrefs.find((p: any) => p.kind === "shared")
    await call(A, "PUT", "/account/notification-prefs", { prefs: { shared: { email: old.email, bell: old.bell } } })
    check("bad pref kind is 400", (await call(A, "PUT", "/account/notification-prefs", { prefs: { nope: { email: true, bell: true } } })).status === 400)
    check("vault lock", (await call(A, "PUT", "/account/vault-lock", { minutes: 30 })).status === 200 && (await call(A, "GET", "/account")).body.vaultLockMinutes === 30)
    check("vault lock rejects other values", (await call(A, "PUT", "/account/vault-lock", { minutes: 7 })).status === 400)
    await call(A, "PUT", "/account/vault-lock", { minutes: before.vaultLockMinutes })

    const av = await call(A, "GET", "/account/avatars")
    check("avatar presets", av.body.presets?.length > 5, av.body)
    const target = av.body.presets.find((p: string) => p !== av.body.current)
    check("pick avatar", (await call(A, "PUT", "/account/avatar", { choice: target })).status === 200 && (await call(A, "GET", "/account/avatars")).body.current === target)
    check("a made-up avatar is refused", (await call(A, "PUT", "/account/avatar", { choice: "/evil.png" })).status === 400)
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)])
    const form = new FormData()
    form.set("file", new Blob([jpeg], { type: "image/jpeg" }), "a.jpg")
    const up = await fetch(`${BASE}/api/v1/account/avatar`, { method: "POST", headers: { authorization: `Bearer ${A}` }, body: form })
    check("upload avatar", up.status === 200, up.status)
    const now = (await call(A, "GET", "/account/avatars")).body.current
    const img = await fetch(`${BASE}${now}`, { headers: { authorization: `Bearer ${A}` } })
    check("GET /api/avatar/{key} with a bearer", now.startsWith("/api/avatar/") && img.status === 200, [now, img.status])
    const badForm = new FormData()
    badForm.set("file", new Blob([Buffer.from("not an image")]), "a.jpg")
    check("a non-JPEG is refused", (await fetch(`${BASE}/api/v1/account/avatar`, { method: "POST", headers: { authorization: `Bearer ${A}` }, body: badForm })).status === 400)
    await call(A, "PUT", "/account/avatar", { choice: before.profile.image })

    const ap = await call(A, "POST", "/account/app-passwords", { name: RUN, scope: "ro" })
    check("create app password", typeof ap.body.password === "string", ap)
    const listed = (await call(A, "GET", "/account")).body.appPasswords.find((x: any) => x.name === RUN)
    check("list app passwords", listed && listed.lastFour === ap.body.password.slice(-4), listed)
    check("revoke app password", (await call(A, "DELETE", `/account/app-passwords/${listed.id}`)).status === 200 && !(await call(A, "GET", "/account")).body.appPasswords.some((x: any) => x.name === RUN))
    check("wrong current password", (await call(A, "POST", "/account/password", { current: "wrong-wrong-1", next: "a-new-password-123" })).status === 400)
    check("password needs a body", (await call(A, "POST", "/account/password", {})).status === 400)
    check("password signed-out is 401", (await call(null, "POST", "/account/password", { current: "a", next: "b" })).status === 401)
  })

  // ---- storage
  await group("storage", async () => {
    const s = await call(A, "GET", "/storage")
    check("storage report", s.body.usage?.used >= 0 && Array.isArray(s.body.largest) && s.body.trash && s.body.folder, Object.keys(s.body ?? {}))
    const d = await call(A, "GET", `/storage?folder=${folderId}`)
    check("storage report for a folder", d.body.folder?.id === folderId, d.body?.folder)
  })

  // ---- vaults (fake keys: the server never sees a passphrase)
  await group("vaults", async () => {
    const list = await call(A, "GET", "/vaults")
    check("list vaults", list.body.vaults.some((v: any) => v.name === "Taxes") && "canCreate" in list.body, list.body)
    const taxes = list.body.vaults.find((v: any) => v.name === "Taxes")
    if (taxes) {
      const k = await call(A, "GET", `/vaults/${taxes.id}`)
      check("vault keys", k.body.salt && k.body.wrapped && k.body.kdf?.m, Object.keys(k.body))
      const tree = await call(A, "GET", `/vaults/${taxes.id}/tree`)
      check("vault tree", tree.body.nodes?.length > 0, tree.status)
      const file = tree.body.nodes.find((n: any) => n.kind === "file" && !n.trashedAt)
      const url = file && (await call(A, "GET", `/vaults/${taxes.id}/files/${file.id}`))
      check("vault file url", url?.body.url && url.body.encKey, url?.status)
      check("B can't open A's vault", (await call(B, "GET", `/vaults/${taxes.id}`)).status === 404 && (await call(B, "GET", `/vaults/${taxes.id}/tree`)).status === 404)
    }
    const keys = { salt: "AAAAAAAAAAAAAAAAAAAAAA==", wrapped: "BBBBBBBBBBBBBBBBBBBBBBBB", recoveryWrapped: "CCCCCCCCCCCCCCCCCCCCCCCC", kdf: { t: 3, m: 65536 } }
    const c = await call(A, "POST", "/vaults", { name: RUN, ...keys })
    if (c.status === 400 && /off|most/.test(c.body.message)) return check("vaults are off or capped here", true)
    const vid = c.body?.id
    check("create vault", vid, c)
    cleanup.push(() => call(A, "DELETE", `/vaults/${vid}`))
    check("bad keys are refused", (await call(A, "POST", "/vaults", { name: "x", ...keys, kdf: { t: 1, m: 1 } })).status === 400)
    check("new passphrase", (await call(A, "PUT", `/vaults/${vid}/key`, { salt: "DDDDDDDDDDDDDDDDDDDDDD==", wrapped: "EEEEEEEEEEEEEEEEEEEEEEEE", kdf: keys.kdf })).status === 200)
    const fo = await call(A, "POST", `/vaults/${vid}/folders`, { folders: [{ key: "a", parent: null, name: "Zm9sZGVyMQ==", tag: "dGFnMQ==" }, { key: "b", parent: "a", name: "Zm9sZGVyMg==", tag: "dGFnMg==" }] })
    check("create vault folders", fo.body.ids?.a && fo.body.ids.b, fo.body)
    const { a, b } = fo.body.ids
    check("rename vault node", (await call(A, "PATCH", `/vaults/${vid}/nodes/${b}`, { name: "Zm9sZGVyMw==", tag: "dGFnMw==" })).status === 200)
    check("tags for older items", (await call(A, "POST", `/vaults/${vid}/tags`, { tags: [{ id: a, tag: "dGFnMQ==" }] })).status === 200)
    check("move vault node", (await call(A, "POST", `/vaults/${vid}/nodes/move`, { ids: [b], parentId: null })).status === 200)
    check("trash vault node", (await call(A, "POST", `/vaults/${vid}/nodes/trash`, { ids: [b] })).status === 200)
    const tree = await call(A, "GET", `/vaults/${vid}/tree`)
    check("trashed node shows in the tree", tree.body.nodes.find((n: any) => n.id === b)?.trashedAt)
    const rs = await call(A, "POST", `/vaults/${vid}/nodes/restore`, { ids: [b] })
    check("restore vault node", rs.status === 200 && rs.body.kept === 0, rs.body)
    const pl = await call(A, "POST", `/vaults/${vid}/uploads/plan`, { groups: [{ parentId: a, sizes: [10, 20] }] })
    check("plan vault upload", pl.body.tokens?.length === 1, pl.body)
    check("delete vault nodes", (await call(A, "POST", `/vaults/${vid}/nodes/delete`, { ids: [b] })).status === 200)
    check("B can't change A's vault", (await call(B, "POST", `/vaults/${vid}/nodes/trash`, { ids: [a] })).status === 404)
    check("delete vault", (await call(A, "DELETE", `/vaults/${vid}`)).status === 200 && (await call(A, "GET", `/vaults/${vid}`)).status === 404)
  })

  // ---- live events
  await group("events", async () => {
    const ac = new AbortController()
    const res = await fetch(`${BASE}/api/v1/events`, { headers: { authorization: `Bearer ${A}` }, signal: ac.signal })
    const first = new TextDecoder().decode((await res.body!.getReader().read()).value)
    ac.abort()
    check("stream opens with retry", res.status === 200 && res.headers.get("content-type") === "text/event-stream" && first.startsWith("retry: 10000"), first)
  })

  // ---- push
  await group("push", async () => {
    const endpoint = `https://ntfy.example.com/${RUN}`
    const r = await call(A, "POST", "/push", { endpoint })
    if (r.status === 500) return check("push table is missing: apply drizzle migration 0026", false, r.status)
    check("register endpoint", r.status === 200, r)
    check("register again (idempotent)", (await call(A, "POST", "/push", { endpoint })).status === 200)
    const rows = await sql`select user_id from push_endpoints where endpoint = ${endpoint}`
    check("one row, owned by A", rows.length === 1 && rows[0].user_id === me.id, rows)
    check("B registering A's endpoint doesn't take it", (await call(B, "POST", "/push", { endpoint })).status === 200 && (await sql`select user_id from push_endpoints where endpoint = ${endpoint}`)[0]?.user_id === me.id)
    const bad = await fetch(`${BASE}/api/auth/app-return/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "nope" }) })
    check("unknown app-return code is refused", bad.status === 400, bad.status)
    check("not a URL", (await call(A, "POST", "/push", { endpoint: "nope" })).status === 400)
    check("not http", (await call(A, "POST", "/push", { endpoint: "ftp://x/y" })).status === 400)
    check("B can't delete A's endpoint", ((await call(B, "DELETE", "/push", { endpoint })).status === 200) && (await sql`select 1 from push_endpoints where endpoint = ${endpoint}`).length === 1)
    check("unregister", (await call(A, "DELETE", "/push", { endpoint })).status === 200 && (await sql`select 1 from push_endpoints where endpoint = ${endpoint}`).length === 0)
  })

  // ---- two-factor and sessions through Better Auth, on a throwaway account
  const throwaway = `${RUN}@example.invalid`
  let throwawayId = ""
  cleanup.push(async () => {
    if (throwawayId) await sql`delete from "user" where id = ${throwawayId}`
  })
  await group("gated accounts, password, two-factor, sessions", async () => {
    const su = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: "nimbus://", "content-type": "application/json" },
      body: JSON.stringify({ name: "Api Check", email: throwaway, password: PASSWORD }),
    })
    if (su.status !== 200) return check(`sign-up for a throwaway account (${su.status}: sign-ups closed?)`, false, await su.text())
    const [u] = await sql`select id from "user" where email = ${throwaway}`
    throwawayId = u.id
    await sql`update "user" set status = 'active', role = 'member' where id = ${throwawayId}`
    let T = await signIn(throwaway)

    const en = await (await auth(T, "POST", "/two-factor/enable", { password: PASSWORD })).json()
    check("two-factor/enable returns a TOTP URI", /otpauth:\/\//.test(en.totpURI ?? ""), en)
    const secret = new URL(en.totpURI).searchParams.get("secret")!
    const ver = await auth(T, "POST", "/two-factor/verify-totp", { code: totp(secret) })
    check("two-factor/verify-totp turns it on", ver.status === 200, ver.status)
    // Verifying hands back a fresh session token.
    T = ver.headers.get("set-auth-token") ?? T
    check("GET /me says twoFactor", (await call(T, "GET", "/me")).body.twoFactor === true)
    const off = await auth(T, "POST", "/two-factor/disable", { password: PASSWORD })
    const tOff = off.headers.get("set-auth-token")
    check("two-factor changes hand back a new session token (the old one stops working)", tOff && (await call(T, "GET", "/me")).status === 401)
    T = tOff ?? T
    check("two-factor/disable", off.status === 200 && (await call(T, "GET", "/me")).body.twoFactor === false, off.status)

    const ls = await auth(T, "GET", "/list-sessions")
    check("list-sessions with a bearer", ls.status === 200 && (await ls.json()).length >= 1)
    const T2 = await signIn(throwaway)
    check("revoke-other-sessions", (await auth(T, "POST", "/revoke-other-sessions", {})).status === 200 && (await call(T2, "GET", "/me")).status === 401)

    // temporary password: gated everywhere except /me and the password route
    await sql`update "user" set password_temporary = true where id = ${throwawayId}`
    const g = await call(T, "GET", "/files")
    check("temporary password: /files is 403 gated", g.status === 403 && g.body.error === "gated", g)
    const gm = await call(T, "GET", "/me")
    check("...but /me says why", gm.status === 200 && gm.body.gate === "temporary-password", gm.body)
    check("...and writes are 403 too", (await call(T, "POST", "/folders", { parentId: null, name: "x" })).status === 403)
    const weak = await call(T, "POST", "/account/password", { current: PASSWORD, next: "short" })
    check("a weak new password is refused", weak.status === 400 && weak.body.message, weak)
    const ok = await call(T, "POST", "/account/password", { current: PASSWORD, next: `${PASSWORD}-new` })
    check("password change on a temporary password", ok.status === 200 && ok.body.ok, ok)
    const [{ password_temporary }] = await sql`select password_temporary from "user" where id = ${throwawayId}`
    check("...clears the temporary flag", password_temporary === false)
    const T3 = await signIn(throwaway, `${PASSWORD}-new`)
    check("...and the new password works", (await call(T3, "GET", "/files")).status === 200)

    // pending account
    await sql`update "user" set status = 'pending' where id = ${throwawayId}`
    const p = await call(T3, "GET", "/files")
    check("pending account: /files is 403", p.status === 403 && p.body.error === "gated", p)
    check("pending account: /vaults is 403", (await call(T3, "GET", "/vaults")).status === 403)
    check("pending account: /me says pending", (await call(T3, "GET", "/me")).body.gate === "pending")
    check("sign out", (await auth(T3, "POST", "/sign-out", {})).status === 200 && (await call(T3, "GET", "/me")).status === 401)
  })
}

try {
  await main()
} finally {
  console.log("\ncleanup")
  for (const f of cleanup.reverse())
    await f().catch((e) => console.log(`  cleanup step failed: ${e.message}`))
  await sql.end()
}
console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
