import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@nimbus/shared"],
  // Native addons (SSH push) can't be bundled.
  serverExternalPackages: ["ssh2"],
  experimental: {
    agentUpgrade: "security",
  },
}

export default nextConfig
