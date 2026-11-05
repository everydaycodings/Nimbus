// Markdown and code. Colours come from the web's theme, with a phone-sized set of languages.
// ponytail: about 30 languages, not shiki's 300, to keep this page small; the rest show as plain text.
import { HIGHLIGHT_MAX, TEXT_MAX, formatBytes } from "@nimbus/shared/file-rules"
import DOMPurify from "dompurify"
import { marked } from "marked"
import { createHighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import theme from "@shikijs/themes/github-dark-default"

import { el, meta, read, run } from "./core"

const LANGS: Record<string, () => Promise<unknown>> = {
  js: () => import("@shikijs/langs/javascript"),
  ts: () => import("@shikijs/langs/typescript"),
  jsx: () => import("@shikijs/langs/jsx"),
  tsx: () => import("@shikijs/langs/tsx"),
  json: () => import("@shikijs/langs/json"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  ini: () => import("@shikijs/langs/ini"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  html: () => import("@shikijs/langs/html"),
  xml: () => import("@shikijs/langs/xml"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  md: () => import("@shikijs/langs/markdown"),
  sh: () => import("@shikijs/langs/shellscript"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  php: () => import("@shikijs/langs/php"),
  ruby: () => import("@shikijs/langs/ruby"),
  sql: () => import("@shikijs/langs/sql"),
  docker: () => import("@shikijs/langs/docker"),
  diff: () => import("@shikijs/langs/diff"),
}

// The web's aliases (lib/thumbs.ts), plus the extensions these names don't cover.
const ALIAS: Record<string, string> = {
  h: "c", hpp: "cpp", cc: "cpp", mjs: "js", cjs: "js", htm: "html", conf: "ini", cfg: "ini", env: "dotenv", markdown: "md",
  py: "python", rs: "rust", rb: "ruby", kt: "kotlin", kts: "kotlin", cs: "csharp", yml: "yaml", bash: "sh", zsh: "sh",
  dockerfile: "docker", mts: "ts", cts: "ts", svg: "xml", patch: "diff",
}

function langOf(name: string) {
  const base = name.toLowerCase().split("/").pop()!
  const ext = base.includes(".") ? base.split(".").pop()! : base
  const lang = ALIAS[ext] ?? ext
  return lang in LANGS ? lang : "text"
}

async function highlight(text: string, lang: string) {
  const load = LANGS[lang]
  if (!load || text.length > HIGHLIGHT_MAX) return null
  const grammar = ((await load()) as { default: { name: string }[] }).default
  const h = await createHighlighterCore({ themes: [theme], langs: [grammar as never], engine: createJavaScriptRegexEngine({ forgiving: true }) })
  // A grammar module lists the languages it embeds first, and its own last.
  return h.codeToHtml(text, { lang: grammar[grammar.length - 1].name, theme: "github-dark-default" })
}

function plain(text: string) {
  const pre = el("pre")
  pre.append(el("code", undefined, text))
  return pre
}

// Sets the page's own highlighted output, or a rendered, sanitised Markdown tree.
function html(parent: HTMLElement, markup: string) {
  parent.innerHTML = DOMPurify.sanitize(markup, { FORBID_TAGS: ["style", "form"] })
}

run(async () => {
  const markdown = /\.(md|markdown)$/i.test(meta.name)
  const bytes = await read(0, Math.min(meta.size, TEXT_MAX))
  const text = new TextDecoder().decode(bytes)
  const cut = meta.size > TEXT_MAX

  const tools = el("div", "tools")
  tools.append(`${text.split("\n").length.toLocaleString()} lines${cut ? ` · first ${formatBytes(TEXT_MAX)} of ${formatBytes(meta.size)}` : ""}`, el("span", "gap"))
  const code = el("div", "code")
  const highlighted = await highlight(text, markdown ? "md" : langOf(meta.name)).catch(() => null)
  if (highlighted) html(code, highlighted)
  else code.append(plain(text))

  const wrap = el("button", undefined, "Wrap")
  const setWrap = (on: boolean) => {
    code.classList.toggle("wrap", on)
    wrap.setAttribute("aria-pressed", String(on))
  }
  wrap.onclick = () => setWrap(!code.classList.contains("wrap"))
  setWrap(markdown)

  if (!markdown) {
    tools.append(wrap)
    document.body.append(tools, code)
    return
  }

  const article = el("article", "markdown")
  html(article, await marked.parse(text))
  const toggle = el("button", undefined, "Source")
  let source = false
  const show = () => {
    article.hidden = source
    code.hidden = !source
    wrap.hidden = !source
    toggle.textContent = source ? "Preview" : "Source"
    window.scrollTo(0, 0)
  }
  toggle.onclick = () => {
    source = !source
    show()
  }
  tools.append(wrap, toggle)
  document.body.append(tools, article, code)
  show()
}, "Couldn't read this file.")
