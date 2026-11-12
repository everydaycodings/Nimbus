// Builds viewer/*.ts into one self-contained HTML string per viewer, in src/lib/viewers/ (generated, not committed).
// Run by `npm run viewers`, and by `go` and `start`.
import { createHash } from "node:crypto"
import { build } from "esbuild"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(root, "package.json"))
const out = join(root, "src/lib/viewers")
mkdirSync(out, { recursive: true })

// No network, no navigation, and only this page's own inline script runs: these pages render untrusted files.
// The script is allowed by its hash, so markup inside a document can't run anything even if it got past the sanitising.
const csp = (js) =>
  `default-src 'none'; script-src 'sha256-${createHash("sha256").update(js).digest("base64")}'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; worker-src blob:; connect-src blob: data:; base-uri 'none'; form-action 'none'`

async function bundle(entry, options = {}) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    target: "chrome90",
    legalComments: "none",
    logLevel: "warning",
    ...options,
  })
  return r.outputFiles[0].text
}

const fontFace = (family, weight, file) =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(require.resolve(file)).toString("base64")})}`

const geist = [
  fontFace("Geist", 400, "@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf"),
  fontFace("Geist", 500, "@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf"),
].join("")
const mono = fontFace("Geist Mono", 400, "@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf")
const css = readFileSync(join(root, "viewer/viewer.css"), "utf8")

const pdfWorker = await bundle(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"))

// The PDF editor's page needs pdf.js's own stylesheet (text and form layers); the pictures it points at can't load here anyway.
const pdfViewerCss = readFileSync(require.resolve("pdfjs-dist/web/pdf_viewer.css"), "utf8").replace(/url\([^)]*\)/g, "none")
// The signature pad's handwriting fonts (OFL), the same three as the web's.
const hand = (family, file) =>
  `@font-face{font-family:"${family}";font-weight:400;src:url(data:font/woff2;base64,${readFileSync(require.resolve(`@fontsource/${file}/files/${file}-latin-400-normal.woff2`)).toString("base64")})}`
const handwriting = [hand("Caveat", "caveat"), hand("Dancing Script", "dancing-script"), hand("Great Vibes", "great-vibes")].join("")

const VIEWERS = {
  pdf: { define: { __PDF_WORKER__: JSON.stringify(pdfWorker) }, fonts: "" },
  // Edit mode is its own page, so reading a PDF never loads the editor.
  "pdf-edit": { define: { __PDF_WORKER__: JSON.stringify(pdfWorker) }, fonts: pdfViewerCss },
  signature: { fonts: handwriting },
  docx: { fonts: geist },
  sheet: { fonts: geist },
  pptx: { fonts: geist },
  text: { fonts: geist + mono },
  zip: { fonts: geist },
}

for (const [name, { define, fonts }] of Object.entries(VIEWERS)) {
  const js = (await bundle(join(root, `viewer/${name}.ts`), { define })).replace(/<\/script/gi, "<\\/script")
  // Pinching zoom stays on: it's how a phone reads a wide page.
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5"><meta http-equiv="Content-Security-Policy" content="${csp(js)}"><style>${fonts}${css}</style></head><body><script>${js}</script></body></html>`
  writeFileSync(join(out, `${name}.ts`), `export default ${JSON.stringify(html)}\n`)
  console.log(`${name}: ${(html.length / 1024 / 1024).toFixed(2)} MB`)
}
