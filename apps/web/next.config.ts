import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@nimbus/shared"],
  // Native addons (SSH push) can't be bundled.
  serverExternalPackages: ["ssh2", "acme-client", "node-forge", "@peculiar/x509"],
  experimental: {
    agentUpgrade: "security",
  },
}

export default nextConfig
