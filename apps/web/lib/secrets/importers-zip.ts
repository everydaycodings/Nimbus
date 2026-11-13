// A 1Password .1pux is a zip holding export.data (JSON) and attachments; only the JSON is read.
import { unzip } from "unzipit"

export async function readPux(bytes: Uint8Array) {
  let entries
  try {
    ;({ entries } = await unzip(bytes))
  } catch {
    throw new Error("That file isn't a 1Password .1pux export.")
  }
  const f = entries["export.data"]
  if (!f || f.size > 50 * 1024 * 1024) throw new Error("That .1pux has no export.data.")
  return f.text()
}
