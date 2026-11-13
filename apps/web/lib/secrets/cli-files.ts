// The CLI files this server hands out: Go binaries built into packages/cli-go/dist and
// the bash client. SECRETS_CLI_DIR points at the folder holding cli/ and cli-go/ when
// the repo isn't next to the app.
import "server-only"

import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const base = () => process.env.SECRETS_CLI_DIR || path.join(process.cwd(), "..", "..", "packages")
export const BINARY_RE = /^nimbus-(linux|darwin|windows)-(amd64|arm64)(\.exe)?$/

export async function listBinaries() {
  try {
    const dir = path.join(base(), "cli-go", "dist")
    const names = (await readdir(dir)).filter((n) => BINARY_RE.test(n)).sort()
    return Promise.all(
      names.map(async (name) => {
        const [, os, arch] = name.match(BINARY_RE)!
        return { name, os, arch, size: (await stat(path.join(dir, name))).size }
      })
    )
  } catch {
    return []
  }
}

export const readBinary = (name: string) =>
  BINARY_RE.test(name) ? readFile(path.join(base(), "cli-go", "dist", name)).catch(() => null) : null

export const readScript = () => readFile(path.join(base(), "cli", "nimbus.sh")).catch(() => null)
