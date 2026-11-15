// OCI distribution-spec v1.1 routes. Names are "<namespace>/<repo…>" and may hold
// slashes, so the route is read from the end of the path.
import "server-only"

import { canPull, canPush, catalogFor, createRepoOnPush, resolveRepo } from "./access.ts"
import { getBlob, linked, linkExisting, throttle, unlinkBlob } from "./blobs.ts"
import { RegError, errors, json, respond, type C } from "./http.ts"
import { deleteManifest, getManifest, listTags, page, putManifest, referrers } from "./manifests.ts"
import { isMirror, mirrorBlob, mirrorManifest, mirrorRepo } from "./mirror.ts"
import { splitName, validUploadDigest } from "./rules.ts"
import { contentRange } from "./wire.ts"
import { discard, finish, getUpload, patch, startUpload } from "./uploads.ts"

type Resolved = NonNullable<Awaited<ReturnType<typeof resolveRepo>>>

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    throw new RegError("UNSUPPORTED", "Couldn't parse the request path.", 400)
  }
}

// Reading: anonymous callers are asked to sign in (also for repos that don't exist, so
// nothing leaks); signed-in callers who can't read it get "unknown".
async function readable(c: C, name: string): Promise<Resolved> {
  if (!splitName(name)) throw errors.nameInvalid(name)
  // The pull-through mirror's cached copies (tags/list, referrers); blobs and manifests are handled before this.
  if (isMirror(name)) return { repo: await mirrorRepo(c, name), namespace: null as never }
  const r = await resolveRepo(name)
  if (!r || !(await canPull(c.actor, r.repo, r.namespace))) {
    if (!c.actor.userId) throw errors.unauthorized()
    throw errors.nameUnknown(name)
  }
  return r
}

async function writable(c: C, name: string, create: boolean): Promise<Resolved> {
  if (!splitName(name)) throw errors.nameInvalid(name)
  if (!c.actor.userId) throw errors.unauthorized()
  if (isMirror(name)) throw errors.denied("The pull-through mirror is read-only.")
  const r = await resolveRepo(name)
  if (r) {
    if (!(await canPush(c.actor, r.namespace, r.repo))) throw errors.denied()
    return r
  }
  if (create) {
    const made = await createRepoOnPush(c.actor, name)
    if (made) return made
  }
  throw errors.denied()
}

const base = (name: string, id: string) => `/v2/${name}/blobs/uploads/${id}`
const range = (offset: number) => `0-${Math.max(offset - 1, 0)}`

function uploadHeaders(name: string, id: string, offset: number) {
  return { Location: base(name, id), Range: range(offset), "Docker-Upload-UUID": id, "Content-Length": "0" }
}

// The Content-Range of a chunk, "start-end" (a "bytes " prefix is tolerated): must continue the upload.
function checkRange(c: C, name: string, row: { id: string; offset: number }) {
  const h = c.req.headers.get("content-range")
  if (!h) return
  const r = contentRange(h)
  if (!r || r.start !== row.offset)
    throw new RegError("BLOB_UPLOAD_INVALID", "The chunk doesn't continue the upload.", 416, undefined, uploadHeaders(name, row.id, row.offset))
}

async function uploads(c: C, name: string, id: string | null) {
  const m = c.method
  if (id === null) {
    if (m !== "POST") throw errors.unsupported("Method not allowed.")
    const { repo, namespace } = await writable(c, name, true)
    const digest = c.q.get("digest")
    const mount = c.q.get("mount")
    const from = c.q.get("from")
    if (mount && from) {
      if (!validUploadDigest(mount)) throw errors.digestInvalid("Invalid digest.")
      const src = await resolveRepo(from)
      if (src && (await canPull(c.actor, src.repo, src.namespace)) && (await linked(src.repo.id, mount)) && (await linkExisting(repo.id, namespace, mount)))
        return respond(201, null, { Location: `/v2/${name}/blobs/${mount}`, "Docker-Content-Digest": mount, "Content-Length": "0" })
    }
    const row = await startUpload(repo.id, c.actor.userId)
    if (digest) {
      // Monolithic: the whole blob in this request.
      if (!validUploadDigest(digest)) {
        await discard(row)
        throw errors.digestInvalid("Invalid digest.")
      }
      await finish(row, namespace, digest, await throttle(c.actor.tokenId, c.req.body))
      return respond(201, null, { Location: `/v2/${name}/blobs/${digest}`, "Docker-Content-Digest": digest, "Content-Length": "0" })
    }
    return respond(202, null, uploadHeaders(name, row.id, 0))
  }

  const { repo, namespace } = await writable(c, name, false)
  const row = await getUpload(repo.id, id)
  if (m === "GET") return respond(204, null, uploadHeaders(name, row.id, row.offset))
  if (m === "DELETE") {
    await discard(row)
    return respond(204)
  }
  if (m === "PATCH") {
    checkRange(c, name, row)
    const next = await patch(row, await throttle(c.actor.tokenId, c.req.body))
    return respond(202, null, uploadHeaders(name, next.id, next.offset))
  }
  if (m === "PUT") {
    const digest = c.q.get("digest")
    if (!digest || !validUploadDigest(digest)) throw errors.digestInvalid("A sha256 digest query parameter is required.")
    checkRange(c, name, row)
    await finish(row, namespace, digest, await throttle(c.actor.tokenId, c.req.body))
    return respond(201, null, { Location: `/v2/${name}/blobs/${digest}`, "Docker-Content-Digest": digest, "Content-Length": "0" })
  }
  throw errors.unsupported("Method not allowed.")
}

export async function dispatch(c: C): Promise<Response> {
  const m = c.method
  const head = m === "HEAD"
  const read = m === "GET" || head
  const path = c.path.replace(/\/+$/, "") || "/"

  if (path === "/v2") {
    if (!read) throw errors.unsupported("Method not allowed.")
    if (!c.actor.userId) throw errors.unauthorized()
    return json(200, {}, {}, head)
  }
  if (path === "/v2/_catalog") {
    if (!read) throw errors.unsupported("Method not allowed.")
    const { items, link } = page(c.q, await catalogFor(c.actor), "/v2/_catalog")
    return json(200, { repositories: items }, link ? { Link: link } : {}, head)
  }

  let g: RegExpExecArray | null
  if ((g = /^\/v2\/(.+)\/blobs\/uploads(?:\/([^/]+))?$/.exec(path))) return uploads(c, decode(g[1]), g[2] ? decode(g[2]) : null)
  if ((g = /^\/v2\/(.+)\/blobs\/([^/]+)$/.exec(path))) {
    const [name, digest] = [decode(g[1]), decode(g[2])]
    if (!/^[a-z0-9]+:[a-zA-Z0-9=_-]+$/.test(digest)) throw errors.digestInvalid("Invalid digest.")
    if (read && isMirror(name)) return mirrorBlob(c, name, digest, c.req.headers.get("range"), head)
    if (read) return getBlob((await readable(c, name)).repo.id, digest, c.req.headers.get("range"), head, c.actor.tokenId)
    if (m === "DELETE") {
      await unlinkBlob((await writable(c, name, false)).repo.id, digest)
      return respond(202, null, { "Content-Length": "0" })
    }
  }
  if ((g = /^\/v2\/(.+)\/manifests\/([^/]+)$/.exec(path))) {
    const [name, ref] = [decode(g[1]), decode(g[2])]
    if (read && isMirror(name)) return mirrorManifest(c, name, ref, head)
    if (read) return getManifest((await readable(c, name)).repo, ref, head, c.actor.tokenId)
    if (m === "PUT") return putManifest(c, (await writable(c, name, true)).repo, name, ref)
    if (m === "DELETE") return deleteManifest(c, (await writable(c, name, false)).repo, name, ref)
  }
  if (read && (g = /^\/v2\/(.+)\/tags\/list$/.exec(path))) {
    const name = decode(g[1])
    return listTags(c, (await readable(c, name)).repo, name, head)
  }
  if (read && (g = /^\/v2\/(.+)\/referrers\/([^/]+)$/.exec(path))) {
    const name = decode(g[1])
    return referrers(c, (await readable(c, name)).repo, decode(g[2]), head)
  }
  throw new RegError("UNSUPPORTED", "The operation is unsupported.", g ? 405 : 404)
}
