// What each DNS provider needs; no Node imports so the browser can read it too.
export type DnsProvider = "cloudflare" | "route53" | "digitalocean"
export type DnsCreds = { token?: string; accessKeyId?: string; secretAccessKey?: string }

export const CRED_FIELDS: Record<DnsProvider, { key: keyof DnsCreds; label: string }[]> = {
  cloudflare: [{ key: "token", label: "API token (Zone:DNS:Edit)" }],
  digitalocean: [{ key: "token", label: "Personal access token (write)" }],
  route53: [{ key: "accessKeyId", label: "Access key ID" }, { key: "secretAccessKey", label: "Secret access key" }],
}
