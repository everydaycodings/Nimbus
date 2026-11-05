import { useQuery } from "@tanstack/react-query"
import { Redirect, router } from "expo-router"

import { serverName } from "@/components/avatar"
import { Button, FormScreen, Spinner, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { ApiError, json, type Me } from "@/lib/api"
import { c } from "@/lib/theme"

// Decides where a launch lands: connect, sign in again, a gate, or the files.
export default function Index() {
  const { active, remove } = useAccounts()
  const me = useQuery({
    queryKey: ["me", active?.id],
    enabled: !!active,
    queryFn: () => json<Me>(active!.server, "/api/v1/me", { token: active!.token }),
  })
  if (!active) return <Redirect href="/connect" />
  if (me.data) return <Redirect href={me.data.gate ? "/gate" : "/home"} />
  if (me.error instanceof ApiError && me.error.status === 401)
    return (
      <FormScreen>
        <Text variant="title">Sign in again</Text>
        <Text color={c.mutedForeground}>
          Your session for {active.email} ended. Sign in to keep using {serverName(active.server)}.
        </Text>
        <Button
          label="Sign in"
          onPress={() => {
            // Open sign-in first: removing the account alone would land in another saved account.
            const server = active.server
            router.replace({ pathname: "/sign-in", params: { server } })
            remove(active.id)
          }}
        />
      </FormScreen>
    )
  // ponytail: offline start waits on phase 6's cache; until then it says so plainly.
  if (me.error)
    return (
      <FormScreen>
        <Text variant="title">Can't reach your server</Text>
        <Text color={c.mutedForeground}>{me.error.message}</Text>
        <Button label="Try again" busy={me.isFetching} onPress={() => me.refetch()} />
      </FormScreen>
    )
  return <Spinner />
}
