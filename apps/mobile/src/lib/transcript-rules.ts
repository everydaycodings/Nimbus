// Words for the language Whisper heard; anything else shows its code.
const LANGS: Record<string, string> = {
  ar: "Arabic", bn: "Bengali", zh: "Chinese", cs: "Czech", da: "Danish", nl: "Dutch", en: "English", fi: "Finnish", fr: "French",
  de: "German", el: "Greek", he: "Hebrew", hi: "Hindi", hu: "Hungarian", id: "Indonesian", it: "Italian", ja: "Japanese",
  ko: "Korean", ms: "Malay", mr: "Marathi", no: "Norwegian", fa: "Persian", pl: "Polish", pt: "Portuguese", pa: "Punjabi",
  ro: "Romanian", ru: "Russian", es: "Spanish", sv: "Swedish", ta: "Tamil", te: "Telugu", th: "Thai", tr: "Turkish",
  uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese",
}
export const langName = (code: string | null) => (code ? (LANGS[code.toLowerCase()] ?? code.toUpperCase()) : null)
