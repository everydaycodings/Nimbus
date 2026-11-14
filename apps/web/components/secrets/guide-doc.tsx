import { Parser, marked, type Token, type Tokens } from "marked"
import { Fragment } from "react"

import { CodeBlock } from "@/components/secrets/code-block"

// Renders docs/secrets.md (kept in content/secrets-guide.md) as the in-app guide.
// <!-- app:NAME --> comments in the markdown become the React nodes in `slots`.
export const slug = (text: string) =>
  text.toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/ /g, "-")

export function headings(md: string) {
  const seen = new Map<string, number>()
  return marked
    .lexer(md)
    .filter((t): t is Tokens.Heading => t.type === "heading" && t.depth >= 2 && t.depth <= 3)
    .map((t) => {
      const base = slug(t.text)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      return { depth: t.depth, text: t.text.replace(/`/g, ""), id: n ? `${base}-${n}` : base }
    })
}

const inline = (tokens: Token[] | undefined) => (
  <span dangerouslySetInnerHTML={{ __html: Parser.parseInline(tokens ?? []) }} />
)

const HEAD = {
  2: "mt-12 scroll-mt-20 border-b pb-2 text-xl font-semibold tracking-tight first:mt-0",
  3: "mt-8 scroll-mt-20 text-base font-semibold",
} as const

export function GuideDoc({ md, slots }: { md: string; slots: Record<string, React.ReactNode> }) {
  const ids = headings(md)
  let h = 0
  const block = (t: Token, i: number): React.ReactNode => {
    switch (t.type) {
      case "heading": {
        const x = t as Tokens.Heading
        if (x.depth < 2 || x.depth > 3) return null
        const Tag = `h${x.depth}` as "h2" | "h3"
        return (
          <Tag key={i} id={ids[h++]?.id} className={HEAD[x.depth as 2 | 3]}>
            {inline(x.tokens)}
          </Tag>
        )
      }
      case "paragraph":
        return <p key={i}>{inline((t as Tokens.Paragraph).tokens)}</p>
      case "text":
        return <Fragment key={i}>{inline((t as Tokens.Text).tokens)}</Fragment>
      case "code": {
        const c = t as Tokens.Code
        return <CodeBlock key={i} text={c.text} />
      }
      case "list": {
        const l = t as Tokens.List
        const Tag = l.ordered ? "ol" : "ul"
        return (
          <Tag key={i} className={l.ordered ? "list-decimal space-y-1.5 pl-5" : "list-disc space-y-1.5 pl-5"}>
            {l.items.map((it, j) => (
              <li key={j} className="space-y-2 pl-1">{it.tokens.map(block)}</li>
            ))}
          </Tag>
        )
      }
      case "table": {
        const tb = t as Tokens.Table
        return (
          <div key={i} className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {tb.header.map((c, j) => (
                    <th key={j} className="px-3 py-2 font-medium">{inline(c.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {tb.rows.map((r, j) => (
                  <tr key={j} className="align-top">
                    {r.map((c, k) => (
                      <td key={k} className="max-w-sm px-3 py-2 text-pretty">{inline(c.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      case "html": {
        const m = (t as Tokens.HTML).raw.match(/<!--\s*app:(\w+)\s*-->/)
        return m ? <Fragment key={i}>{slots[m[1]]}</Fragment> : null
      }
      default:
        return null
    }
  }
  // The first H1 is the page title, shown by the page itself.
  const tokens = marked.lexer(md).filter((t) => !(t.type === "heading" && (t as Tokens.Heading).depth === 1))
  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-pretty text-foreground/90 [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:[overflow-wrap:anywhere] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:[overflow-wrap:normal] [&_strong]:font-semibold [&_strong]:text-foreground">
      {tokens.map(block)}
    </div>
  )
}
