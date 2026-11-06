// Collects the licences of everything that ships in the app into src/lib/licences.generated.json (generated, not committed).
// Run by `npm run licences`, and by `go`, `start` and the release script.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// Gradle deps of the Kotlin module (modules/nimbus-android/android/build.gradle).
// ponytail: hand-maintained; add a line when build.gradle gains a dependency. Upgrade path: read the
// licences from the Gradle dependency report (or the oss-licenses plugin) in the release build.
export const NATIVE = [
  ["androidx.work:work-runtime-ktx", "2.10.5", "Apache-2.0"],
  ["com.squareup.okhttp3:okhttp", "4.9.2", "Apache-2.0"],
  ["org.jetbrains.kotlinx:kotlinx-coroutines-android", "1.10.2", "Apache-2.0"],
  ["com.google.android.gms:play-services-mlkit-document-scanner", "16.0.0-beta1", "Apache-2.0"],
  ["org.bouncycastle:bcprov-jdk18on", "1.78.1", "MIT"],
  ["androidx.biometric:biometric", "1.1.0", "Apache-2.0"],
  ["org.unifiedpush.android:connector", "3.3.5", "Apache-2.0"],
]
// Bundled into the viewer pages by build-viewers.mjs; they are not in this workspace's package.json.
const VIEWER_ROOTS = ["docx-preview", "dompurify", "marked", "pdfjs-dist", "shiki", "@shikijs/themes", "unzipit", "xlsx"]

// "MIT", {type: "MIT"}, or the old licenses: [{type}] array.
export function licenseId(pkg) {
  const l = pkg.license ?? pkg.licenses
  const one = (x) => (typeof x === "string" ? x : x?.type)
  if (Array.isArray(l)) return l.map(one).filter(Boolean).join(" OR ") || "Unknown"
  return one(l) || "Unknown"
}

// LICENSE, LICENCE, COPYING or NOTICE files, licence before notice.
export function licenceFiles(names) {
  const rank = (n) => (/^(licen[cs]e|copying)/i.test(n) ? 0 : /^notice/i.test(n) ? 1 : 2)
  return names.filter((n) => rank(n) < 2 && !/\.(js|ts|json|mjs|cjs)$/i.test(n)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

// ponytail: the walk also takes in build tooling that the dependency tree drags along (Metro, Babel, the Expo CLI), a superset of what ships.
// Upgrade path: filter by what Metro bundled. Extra notices are harmless.
// Every package reachable through "dependencies" and "optionalDependencies", resolved the way Node does from each package's folder.
export function walk(rootDirs, read = readFileSync, exists = existsSync) {
  const seen = new Map()
  const resolve = (name, from) => {
    for (let dir = from; ; dir = dirname(dir)) {
      const p = join(dir, "node_modules", name)
      if (exists(join(p, "package.json"))) return p
      if (dir === dirname(dir)) return null
    }
  }
  const visit = (dir) => {
    if (seen.has(dir)) return
    const pkg = JSON.parse(read(join(dir, "package.json"), "utf8"))
    seen.set(dir, pkg)
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const next = resolve(dep, dir)
      if (next) visit(next)
    }
  }
  for (const d of rootDirs) visit(d)
  return [...seen]
}

function main() {
  const mine = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const resolveRoot = (name) => {
    for (let dir = root; ; dir = dirname(dir)) {
      const p = join(dir, "node_modules", name)
      if (existsSync(join(p, "package.json"))) return p
      if (dir === dirname(dir)) throw new Error(`${name} isn't installed: run npm install`)
    }
  }
  const roots = [...Object.keys(mine.dependencies).filter((n) => !n.startsWith("@nimbus/")), ...VIEWER_ROOTS].map(resolveRoot)

  const texts = []
  const index = new Map()
  const textId = (t) => {
    if (!index.has(t)) index.set(t, texts.push(t) - 1)
    return index.get(t)
  }
  const packages = walk(roots).map(([dir, pkg]) => {
    const text = licenceFiles(readdirSync(dir))
      .map((f) => readFileSync(join(dir, f), "utf8").trim())
      .join("\n\n----\n\n")
    return { name: pkg.name, version: pkg.version, license: licenseId(pkg), text: text ? textId(text) : -1 }
  })
  for (const [name, version, license] of NATIVE) {
    packages.push({ name, version, license, text: textId(readFileSync(join(root, "scripts/licence-texts", `${license}.txt`), "utf8").trim()) })
  }
  packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  mkdirSync(join(root, "src/lib"), { recursive: true })
  writeFileSync(join(root, "src/lib/licences.generated.json"), JSON.stringify({ texts, packages }))
  console.log(`licences: ${packages.length} packages, ${texts.length} distinct texts`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
