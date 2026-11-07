// In-app updates: is the server's newest APK newer than this build, and which one suits this phone.
// Free of React Native so a test can run it.

// GET /api/android/latest on the server (apps/web/lib/android-release.ts).
export type Release = { version: string; files: { abi: string; url: string; size: number }[]; notes?: string }

// "0.2.10" > "0.2.9": compared as numbers, part by part.
export function newer(candidate: string, current: string) {
  const a = candidate.split(".").map(Number)
  const b = current.split(".").map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

// The phone's own architecture, else the universal APK. Bundled APKs have server-relative URLs.
export function pickApk(release: Release, abi: string | null, server: string) {
  const file = release.files.find((f) => f.abi === abi) ?? release.files.find((f) => f.abi === "universal")
  return file ? { ...file, url: new URL(file.url, server).toString() } : null
}

// Release notes are the tagged commit's message, wrapped at 72 columns: indented lines carry on the line above.
export const unwrapNotes = (notes: string) => notes.replace(/\n[ \t]+/g, " ")
