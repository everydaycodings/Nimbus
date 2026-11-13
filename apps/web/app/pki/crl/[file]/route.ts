import { limitIp } from "@/lib/api"
import { crlFor } from "@/lib/secrets/pki"

// A private CA's revocation list, signed on request. Public so anything that
// trusts the CA can fetch it: /pki/crl/<ca id>.crl (DER, what certificates point at) or .pem
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const limited = await limitIp("pki-crl")
  if (limited) return limited
  const file = (await ctx.params).file
  const id = file.replace(/\.(crl|pem)$/, "")
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 })
  const pem = await crlFor(id)
  return pem
    ? file.endsWith(".pem")
      ? new Response(pem, { headers: { "content-type": "application/x-pem-file", "cache-control": "max-age=300" } })
      : new Response(Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64"), { headers: { "content-type": "application/pkix-crl", "cache-control": "max-age=300" } }) : new Response("Not found", { status: 404 })
}
