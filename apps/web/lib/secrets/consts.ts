// Shared by the server, the tests and the browser (no dependencies).
export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
// Folder names can't hold "." or "/" because references and paths use them.
export const FOLDER_RE = /^[A-Za-z0-9_-]+$/
export const SECRET_TYPES = ["string", "number", "bool", "url", "json", "pem"] as const
export type SecretType = (typeof SECRET_TYPES)[number]
