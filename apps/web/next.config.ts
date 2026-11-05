import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@nimbus/shared"],
  experimental: {
    agentUpgrade: "security",
  },
}

export default nextConfig
