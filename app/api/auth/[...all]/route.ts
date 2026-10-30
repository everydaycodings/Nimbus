import { getAuth } from "@/lib/auth"

// Through getAuth(), so a saved OIDC change takes effect on the next request.
const handler = async (req: Request) => (await getAuth()).handler(req)

export { handler as GET, handler as POST }
