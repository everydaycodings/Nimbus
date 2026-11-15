// The build status badge as SVG. Pure, so node --test can run it.
export type Badge = { label: string; value: string; color: string }

// Flat two-part badge. Text widths are estimated (no font metrics on the server), which is close enough for 11px Verdana.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const width = (s: string) => Math.round(s.length * 6.6) + 10

export function badgeSvg({ label, value, color }: Badge) {
  const a = width(label)
  const b = width(value)
  const text = (x: number, t: string) =>
    `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${esc(t)}</text><text x="${x}" y="14">${esc(t)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a + b}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}"><title>${esc(label)}: ${esc(value)}</title><clipPath id="r"><rect width="${a + b}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${a}" height="20" fill="#555"/><rect x="${a}" width="${b}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">${text(a / 2, label)}${text(a + b / 2, value)}</g></svg>`
}
