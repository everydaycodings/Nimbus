import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@nimbus/shared"],
  // Native addons (SSH push) can't be bundled.
  serverExternalPackages: ["ssh2", "acme-client", "node-forge", "@peculiar/x509"],
  // Dev logs every server action's arguments, which include tokens, passwords and secret values.
  logging: { serverFunctions: false },
  experimental: {
    agentUpgrade: "security",
  },
}

export default nextConfig
