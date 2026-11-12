// Photos' smart groups (chips): Screenshots, Documents, Receipts and Videos, decided by the
// worker from the path, name, size and type, and for images the rules can't place, from
// OCR text. ponytail: these are heuristics; Phase 19 replaces the OCR part with real search OCR.
export const SMART_GROUPS = ["screenshots", "documents", "receipts", "videos"] as const
export type SmartGroup = (typeof SMART_GROUPS)[number]

export const isSmartGroup = (g: string): g is SmartGroup =>
  (SMART_GROUPS as readonly string[]).includes(g)

const SCREENSHOT = /screen[ _-]?(shot|capture|grab|rec)|bildschirmfoto|capture d.[eé]cran/i
const SCAN = /(^|[\s_/-])(scan(s|ned)?|docscan|camscanner|document|doc)([\s_.\d/-]|$)/i
const RECEIPT = /receipt|invoice|\bbill\b|quittung|rechnung/i
const RECEIPT_WORDS = /\b(total|subtotal|tax|vat|gst|receipt|invoice|amount due|change due|cash|visa|mastercard)\b/gi
const MONEY = /\b\d{1,6}[.,]\d{2}\b/

export type SmartInput = {
  name: string
  /** Folder names above the file, joined with "/". */
  path: string
  mime: string | null
  width: number | null
  height: number | null
  /** The EXIF says a camera took it (a date or a GPS fix). */
  camera: boolean
}

/**
 * The groups the rules decide, or null when an image needs OCR to tell.
 * Empty array: decided, in none.
 */
export function smartRules(f: SmartInput): SmartGroup[] | null {
  if (f.mime?.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g|3gp|ogv)$/i.test(f.name))
    return ["videos"]
  if (!f.mime?.startsWith("image/") && !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i.test(f.name))
    return []
  const where = `${f.path}/${f.name}`
  if (SCREENSHOT.test(where)) return ["screenshots"]
  if (RECEIPT.test(where)) return ["receipts"]
  if (SCAN.test(where)) return ["documents"]
  // A phone-screen PNG nothing took a picture of.
  if (/\.png$/i.test(f.name) && !f.camera && f.width && f.height) {
    const long = Math.max(f.width, f.height)
    const short = Math.min(f.width, f.height)
    if (long / short >= 1.6 && short >= 480 && short <= 1700) return ["screenshots"]
  }
  return f.camera ? [] : null
}

/** Groups from what OCR read: amounts with shopping words are a receipt, a page of words a document. */
export function ocrGroups(text: string): SmartGroup[] {
  const words = new Set((text.match(RECEIPT_WORDS) ?? []).map((w) => w.toLowerCase()))
  if (words.size >= 2 && MONEY.test(text)) return ["receipts"]
  return (text.match(/\p{L}{3,}/gu)?.length ?? 0) >= 40 ? ["documents"] : []
}
