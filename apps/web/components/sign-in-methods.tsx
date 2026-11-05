"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"

import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

export type SignInMethod = {
  // "credential" for the password, else a provider id.
  id: string
  label: string
  // The account row, when it's connected.
  accountId?: string
}

// Account → Sign-in methods. Better Auth refuses to remove the last one too.
export function SignInMethods({ methods }: { methods: SignInMethod[] }) {
  const router = useRouter()
  // A provider that bounced the link back, e.g. a different email.
  const bounced = useSearchParams().get("error")
  const [error, setError] = useState<string | null>(
    bounced
      ? "That didn't connect. The provider's email must match this account's."
      : null
  )
  const [pending, start] = useTransition()
  const last = methods.filter((m) => m.accountId).length <= 1

  const connect = (id: string) =>
    start(async () => {
      setError(null)
      const { error } = await authClient.linkSocial({
        provider: id,
        callbackURL: "/account",
        errorCallbackURL: "/account",
      })
      if (error) setError(error.message ?? "Couldn't reach the provider.")
    })

  const disconnect = (accountId: string) =>
    start(async () => {
      setError(null)
      const { error } = await authClient.unlinkAccount({ accountId })
      if (error) setError(error.message ?? "Couldn't disconnect it.")
      else router.refresh()
    })

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-lg border">
        {methods.map((m) => (
          <li
            key={m.id}
            className="flex min-h-12 items-center justify-between gap-3 px-4 py-2"
          >
            <span className="flex items-center gap-2 text-sm">
              {m.label}
              {m.accountId && (
                <CheckCircleIcon
                  weight="fill"
                  aria-label="Connected"
                  className="size-4 text-brand"
                />
              )}
            </span>
            {m.id === "credential" ? (
              <span className="text-sm text-muted-foreground">
                {m.accountId ? "Set" : "Not set"}
              </span>
            ) : m.accountId ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending || last}
                title={last ? "It's your only way to sign in." : undefined}
                onClick={() => disconnect(m.accountId!)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => connect(m.id)}
              >
                Connect
              </Button>
            )}
          </li>
        ))}
      </ul>
      <FormError>{error}</FormError>
    </div>
  )
}
