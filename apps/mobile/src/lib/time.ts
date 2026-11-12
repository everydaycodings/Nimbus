// Plain words, not Intl.RelativeTimeFormat, which Hermes doesn't have on Android.
export function since(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  for (const [unit, n] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    const count = Math.floor(s / n)
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`
  }
  return "just now"
}

export const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}
