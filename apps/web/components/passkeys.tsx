"use client"

import { FingerprintIcon, PlusIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"

export type PasskeyItem = { id: string; name: string; created: string }

const ERROR = "Something went wrong. Try again."

// Name it, then the browser or phone asks to create the passkey.
export function AddPasskey({ first = false }: { first?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        setBusy(true)
        const name = String(new FormData(e.currentTarget).get("name")).trim()
        const { error } = await authClient.passkey.addPasskey({
          name: name || "Passkey",
        })
        setBusy(false)
        if (error)
          return setError(
            // Cancelling the browser's prompt isn't worth a message.
            "code" in error && error.code === "ERROR_CEREMONY_ABORTED"
              ? null
              : (error.message ?? ERROR)
          )
        router.refresh()
      }}
    >
      <div className="grid max-w-sm gap-2">
        <Label htmlFor="passkey-name">
          {first ? "Name this passkey" : "Name for the new passkey"}
        </Label>
        <Input
          id="passkey-name"
          name="name"
          maxLength={60}
          placeholder="My laptop"
          autoComplete="off"
        />
      </div>
      <FormError>{error}</FormError>
      <SubmitButton
        pending={busy}
        variant={first ? "default" : "outline"}
        className="self-start"
      >
        <PlusIcon />
        Add a passkey
      </SubmitButton>
    </form>
  )
}

// The forced "Set up a passkey" screen's body.
export function PasskeySetup() {
  return <AddPasskey first />
}

export function PasskeyList({ items }: { items: PasskeyItem[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(
    fn: () => Promise<{ error: { message?: string } | null }>,
    after: () => void
  ) {
    setError(null)
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) return setError(error.message ?? ERROR)
    after()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-lg border">
        {items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <FingerprintIcon className="size-5 shrink-0 text-muted-foreground" />
            {editing === p.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = String(new FormData(e.currentTarget).get("name")).trim()
                  if (!name) return
                  run(
                    () => authClient.passkey.updatePasskey({ id: p.id, name }),
                    () => setEditing(null)
                  )
                }}
              >
                <Input
                  name="name"
                  aria-label="Passkey name"
                  defaultValue={p.name}
                  maxLength={60}
                  autoFocus
                  required
                />
                <Button type="submit" size="sm" disabled={busy}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {p.created}
                  </p>
                </div>
                {removing === p.id ? (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => authClient.passkey.deletePasskey({ id: p.id }),
                          () => setRemoving(null)
                        )
                      }
                    >
                      Remove it
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(null)}
                    >
                      Keep
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => (setEditing(p.id), setError(null))}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => (setRemoving(p.id), setError(null))}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <FormError>{error}</FormError>
    </div>
  )
}
