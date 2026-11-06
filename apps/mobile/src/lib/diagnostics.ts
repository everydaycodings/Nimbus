// The text Copy diagnostics puts on the clipboard. Pure, so the masking can be tested: server addresses
// and emails never appear in full.

export function maskHost(server: string) {
  const m = /^(https?):\/\/([^/:?#]+|\[[^\]]*\])(?::(\d+))?/i.exec(server.trim())
  if (!m) return "?"
  return `${m[1].toLowerCase()}://${m[2][0]}…${m[3] ? `:${m[3]}` : ""}`
}

export function maskEmail(email: string) {
  const [name, domain] = email.split("@")
  if (!name || !domain) return "?"
  return `${name[0]}…@${domain[0]}…`
}

// Error messages can quote an address or an email; scrub both.
export const scrub = (text: string) =>
  text
    .replace(/https?:\/\/[^\s/:?#]+(?::\d+)?[^\s]*/gi, (u) => maskHost(u))
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, (e) => maskEmail(e))

export type DiagnosticsInput = {
  app: { version: string; build: string; runtime: "APK" | "Expo Go" }
  device: { android: string; model: string }
  accounts: { server: string; email: string; apiVersion?: number; version?: string }[]
  push: string
  backup: string
  offlineBytes: string
  uploadQueue: number
  filesApp: boolean
  errors: { at: number; source: string; message: string }[]
}

export function diagnosticsText(d: DiagnosticsInput) {
  const lines = [
    `Nimbus ${d.app.version} (build ${d.app.build}), ${d.app.runtime}`,
    `Android ${d.device.android}, ${d.device.model}`,
    "",
    ...d.accounts.map(
      (a, i) => `Account ${i + 1}: ${maskHost(a.server)}, ${maskEmail(a.email)}, API ${a.apiVersion ?? "unknown"}, server ${a.version ?? "unknown"}`
    ),
    "",
    `Push: ${d.push}`,
    `Camera backup: ${d.backup}`,
    `Offline files: ${d.offlineBytes}`,
    `Uploads in queue: ${d.uploadQueue}`,
    `Files app: ${d.filesApp ? "on" : "off"}`,
    "",
    `Last ${d.errors.length} errors:`,
    ...d.errors.map((e) => `${new Date(e.at).toISOString()} [${e.source}] ${scrub(e.message)}`),
  ]
  return lines.join("\n")
}
