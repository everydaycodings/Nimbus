// What every registry handler gets, and how it answers (OCI distribution-spec errors).
import "server-only"

import type { Actor } from "./access.ts"

export class RegError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public detail?: unknown,
    public headers?: Record<string, string>
  ) {
    super(message)
  }
}

export const errors = {
  unauthorized: (m = "Authentication required.") => new RegError("UNAUTHORIZED", m, 401, undefined, CHALLENGE),
  denied: (m = "Requested access to the resource is denied.") => new RegError("DENIED", m, 403),
  nameUnknown: (name: string) => new RegError("NAME_UNKNOWN", "Repository name not known to registry.", 404, { name }),
  nameInvalid: (name: string) => new RegError("NAME_INVALID", "Invalid repository name.", 400, { name }),
  blobUnknown: (digest: string) => new RegError("BLOB_UNKNOWN", "Blob unknown to registry.", 404, { digest }),
  manifestUnknown: (ref: string) => new RegError("MANIFEST_UNKNOWN", "Manifest unknown.", 404, { reference: ref }),
  manifestInvalid: (m: string) => new RegError("MANIFEST_INVALID", m, 400),
  digestInvalid: (m = "Provided digest did not match uploaded content.") => new RegError("DIGEST_INVALID", m, 400),
  uploadUnknown: () => new RegError("BLOB_UPLOAD_UNKNOWN", "Blob upload unknown to registry.", 404),
  uploadInvalid: (m: string, status = 400) => new RegError("BLOB_UPLOAD_INVALID", m, status),
  unsupported: (m: string) => new RegError("UNSUPPORTED", m, 405),
}

export const CHALLENGE = {
  "WWW-Authenticate": 'Basic realm="Nimbus Registry"',
}

export type C = {
  req: Request
  method: string
  path: string
  q: URLSearchParams
  actor: Actor
  // Who to name in audit rows, and the client address.
  who: { name: string; ip: string | null }
}

export function respond(status: number, body?: BodyInit | null, headers: HeadersInit = {}) {
  return new Response(body ?? null, {
    status,
    headers: { "Docker-Distribution-API-Version": "registry/2.0", ...headers },
  })
}

export const json = (status: number, data: unknown, headers: HeadersInit = {}, head = false) => {
  const body = JSON.stringify(data)
  return respond(status, head ? null : body, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
    ...headers,
  })
}

export function errorResponse(e: RegError, head = false) {
  const body = JSON.stringify({ errors: [{ code: e.code, message: e.message, detail: e.detail ?? null }] })
  return respond(e.status, head ? null : body, {
    ...e.headers,
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  })
}
