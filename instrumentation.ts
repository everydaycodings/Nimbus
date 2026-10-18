// Runs once when the server starts: refuse to boot without what Nimbus can't run without.
export function register() {
  if (!process.env.REDIS_URL)
    throw new Error(
      "REDIS_URL is not set. Nimbus needs Redis; local_server/compose.yml runs one on port 6380."
    )
}
