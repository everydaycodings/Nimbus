import { twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

// Sign-in forms check `twoFactorRedirect` themselves and route to /two-factor.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] })
