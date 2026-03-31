export function parseUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let device = "Desktop";

  // Browser detection
  if (ua.includes("chrome") && !ua.includes("edg")) browser = "Chrome";
  else if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("edg")) browser = "Edge";
  else if (ua.includes("trident") || ua.includes("msie")) browser = "IE";

  // OS detection
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os x")) os = "macOS";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
  else if (ua.includes("linux")) os = "Linux";

  // Device detection
  if (ua.includes("mobi") || ua.includes("android") || ua.includes("iphone")) {
    device = "Mobile";
    if (ua.includes("ipad") || ua.includes("tablet")) device = "Tablet";
  }

  return { browser, os, device };
}
