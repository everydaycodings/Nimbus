// Quoted fields with "" escapes, LF or CRLF line ends. Stops after `max` rows.
export function parseCsv(text: string, sep = ",", max = Infinity) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += c
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && !field) quoted = true
    else if (c === sep) {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      rows.push([...row, field])
      row = []
      field = ""
    } else field += c
  }
  if ((field || row.length) && rows.length < max) rows.push([...row, field])
  return rows
}
