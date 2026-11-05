// Pure rules for push endpoints, kept apart so tests can run them.

// Anything that isn't a public address. IPv4-mapped IPv6 is checked as IPv4.
export function isPrivateIp(ip: string) {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b < 128) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  return (
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  )
}
