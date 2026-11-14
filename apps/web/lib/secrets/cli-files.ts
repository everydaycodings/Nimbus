// The CLI files this server hands out: Go binaries built into packages/cli-go/dist, the
// Node CLI (one ESM file and an npm-installable tarball, `npm run cli:build`) and the bash
// client. SECRETS_CLI_DIR points at the folder holding cli/ and cli-go/ when the repo
// isn't next to the app (the Docker image sets it).
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

// Download name -> where the Node CLI build puts it.
export const NODE_FILES: Record<string, string> = {
  "nimbus.mjs": "cli/dist/cli.js",
  "nimbus-cli.tgz": "cli/release/nimbus-cli.tgz",
}

export const readBinary = (name: string) =>
  BINARY_RE.test(name)
    ? readFile(path.join(base(), "cli-go", "dist", name)).catch(() => null)
    : Object.hasOwn(NODE_FILES, name)
      ? readFile(path.join(base(), NODE_FILES[name])).catch(() => null)
      : null

// Which Node CLI files are here, for the downloads list.
export const listNodeFiles = async () =>
  (
    await Promise.all(
      Object.entries(NODE_FILES).map(async ([name, rel]) =>
        stat(path.join(base(), rel)).then(
          (s) => ({ name, os: "node", arch: name.endsWith(".tgz") ? "npm package" : "single file", size: s.size }),
          () => null
        )
      )
    )
  ).filter((f) => f !== null)

export const readScript = () => readFile(path.join(base(), "cli", "nimbus.sh")).catch(() => null)
