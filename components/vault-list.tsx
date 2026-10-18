"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { createVault, myVaults } from "@/app/(app)/vault/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import {
  PasswordInput,
  StrengthMeter,
  usePasswordPolicy,
} from "@/components/password-input"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useVaultKeys } from "@/components/vault-keys"
import { formatBytes } from "@/lib/file-types"
import { minLength, passwordProblem } from "@/lib/password-policy"
import { cn } from "@/lib/utils"
import type { VaultSummary } from "@/lib/vault"
import { newVault } from "@/lib/vault-crypto"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function VaultList({
  vaults,
  canCreate,
  why,
}: {
  vaults: VaultSummary[]
  canCreate: boolean
  why: string | null
}) {
  const { keys } = useVaultKeys()
  const [creating, setCreating] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-auto flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Files here are encrypted in your browser before they upload. The
            server, and whoever runs it, sees only scrambled bytes.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            New vault
          </Button>
        )}
      </div>
      {why && <p className="text-sm text-muted-foreground">{why}</p>}

      {vaults.length ? (
        <div className="grid gap-gap-ui sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
          {vaults.map((v) => {
            const open = keys.has(v.id)
            const Icon = open ? LockOpenIcon : LockIcon
            return (
              <Link
                key={v.id}
                href={`/vault/${v.id}`}
                className="flex items-center gap-3 rounded-xl border p-4 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-lg",
                    open ? "bg-brand/10 text-brand" : "bg-muted"
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-medium">{v.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {plural(v.items, "file")} · {formatBytes(v.bytes)}
                    {open && " · Unlocked"}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <ShieldCheckIcon
            weight="light"
            className="size-12 text-muted-foreground"
          />
          <p className="font-medium">No vaults yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            A vault keeps your most private files behind a passphrase only you
            know. Nimbus canNimbus can&apos;t preview, search or recover them
            for you.apos;t read, search or recover them for you.
          </p>
        </div>
      )}

      {creating && <CreateVault onClose={() => setCreating(false)} />}
    </div>
  )
}

type Made = Awaited<ReturnType<typeof newVault>> & { name: string }

// Three steps: what a vault costs, a name and passphrase, then the recovery
// key, which must be copied or saved before the vault is created.
function CreateVault({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { unlock } = useVaultKeys()
  const [step, setStep] = useState<"about" | "pass" | "recovery">("about")
  const [understood, setUnderstood] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const policy = usePasswordPolicy()

  async function makeKeys(form: FormData) {
    const name = String(form.get("name")).trim()
    const pass = String(form.get("pass"))
    if (!name) return setError("Give the vault a name.")
    const problem = passwordProblem(pass, policy, true)
    if (problem) return setError(problem)
    if (pass !== form.get("again"))
      return setError("The passphrases don't match.")
    setError(null)
    setPending(true)
    try {
      setMade({ ...(await newVault(pass)), name })
      setStep("recovery")
    } catch {
      setError("This browser couldn't make the vault's keys.")
    } finally {
      setPending(false)
    }
  }

  async function finish() {
    if (!made) return
    setPending(true)
    const res = await createVault({
      name: made.name,
      salt: made.salt,
      wrapped: made.wrapped,
      recoveryWrapped: made.recoveryWrapped,
      kdf: made.kdf,
    }).catch(() => ({ error: "Couldn't create the vault. Try again." }))
    setPending(false)
    if ("id" in res && res.id) {
      unlock(res.id, made.vk)
      router.push(`/vault/${res.id}`)
      onClose()
    } else setError(res.error ?? "Couldn't create the vault.")
  }

  function download() {
    if (!made) return
    const text = `Nimbus vault recovery key\n\nVault: ${made.name}\nKey: ${made.recoveryCode}\n\nAnyone with this key can open the vault. Keep it somewhere safe and offline.\n`
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
    a.download = `${made.name} recovery key.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    setSaved(true)
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-w-lg")}>
          {step === "about" && (
            <>
              <Dialog.Title className="text-base font-semibold">
                Before you make a vault
              </Dialog.Title>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Files and their names are encrypted in this browser. The
                  server stores only ciphertext it can&apos;t read.
                </li>
                <li>
                  Nimbus can&apos;t make thumbnails, read text for search or
                  share vault files. Previews happen in your browser after you
                  unlock.
                </li>
                <li>
                  You&apos;ll get a recovery key once. If you lose both it and
                  your passphrase,{" "}
                  <strong className="text-foreground">
                    nobody can get these files back
                  </strong>
                  , not even an admin.
                </li>
              </ul>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  className="mt-0.5 size-4 accent-brand"
                />
                I understand that a lost passphrase and recovery key means lost
                files.
              </label>
              <div className="flex justify-end gap-2">
                <Dialog.Close render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <Button disabled={!understood} onClick={() => setStep("pass")}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === "pass" && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                makeKeys(new FormData(e.currentTarget))
              }}
            >
              <Dialog.Title className="text-base font-semibold">
                Name and passphrase
              </Dialog.Title>
              <div className="grid gap-2">
                <label htmlFor="vault-name" className="text-sm font-medium">
                  Vault name
                </label>
                <Input
                  id="vault-name"
                  name="name"
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Taxes"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  The name isn&apos;t encrypted, so the server can see it.
                </p>
              </div>
              <PassphraseFields />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setStep("about")}
                >
                  Back
                </Button>
                <SubmitButton pending={pending}>Continue</SubmitButton>
              </div>
            </form>
          )}

          {step === "recovery" && made && (
            <>
              <Dialog.Title className="text-base font-semibold">
                Save your recovery key
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                It opens “{made.name}” if you forget the passphrase. Nimbus
                won&apos;t show it again.
              </Dialog.Description>
              <p className="rounded-lg border bg-muted/40 p-3 text-center font-mono text-sm leading-relaxed tracking-wide break-words select-all">
                {made.recoveryCode}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyCode
                  value={made.recoveryCode}
                  onCopied={() => setSaved(true)}
                />
                <Button variant="outline" size="sm" onClick={download}>
                  <DownloadSimpleIcon />
                  Download .txt
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-3">
                {!saved && (
                  <p className="mr-auto text-xs text-muted-foreground">
                    Copy or download it to continue.
                  </p>
                )}
                <Button disabled={!saved || pending} onClick={finish}>
                  Create vault
                </Button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CopyCode({
  value,
  onCopied,
}: {
  value: string
  onCopied: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        onCopied()
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </Button>
  )
}

// New passphrase, repeated, with a strength meter.
// Fields are named `pass` and `again`.
export function PassphraseFields({ label = "Passphrase" }: { label?: string }) {
  const [pass, setPass] = useState("")
  const min = minLength(usePasswordPolicy(), true)

  return (
    <>
      <div className="grid gap-2">
        <label htmlFor="vault-pass" className="text-sm font-medium">
          {label}
        </label>
        <PasswordInput
          id="vault-pass"
          name="pass"
          autoComplete="new-password"
          minLength={min}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          aria-describedby="vault-pass-hint"
        />
        <StrengthMeter id="vault-pass-hint" password={pass} vault />
      </div>
      <div className="grid gap-2">
        <label htmlFor="vault-again" className="text-sm font-medium">
          Repeat it
        </label>
        <PasswordInput
          id="vault-again"
          name="again"
          autoComplete="new-password"
        />
      </div>
    </>
  )
}

// From My files: pick a vault, which opens (asking for its passphrase if it's
// locked) and encrypts the items in. The originals go once all of them land.
export function MoveToVault({
  ids,
  label,
  onClose,
}: {
  ids: string[]
  label: string
  onClose: () => void
}) {
  const router = useRouter()
  const { keys } = useVaultKeys()
  const [vaults, setVaults] = useState<{ id: string; name: string }[] | null>(
    null
  )
  useEffect(() => {
    let live = true
    myVaults().then(
      (v) => live && setVaults(v),
      () => live && setVaults([])
    )
    return () => {
      live = false
    }
  }, [])

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              Move {label} to a vault
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              They&apos;re encrypted in this browser and uploaded into the
              vault. Once every file is in, the originals are deleted for good,
              versions included.
            </Dialog.Description>
          </div>
          {!vaults ? (
            <p className="text-sm text-muted-foreground">Loading vaults…</p>
          ) : !vaults.length ? (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have a vault yet.{" "}
              <Link href="/vault" className="text-foreground underline">
                Make one
              </Link>{" "}
              first.
            </p>
          ) : (
            <div className="flex max-h-72 flex-col overflow-y-auto rounded-lg border p-1">
              {vaults.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    router.push(`/vault/${v.id}?import=${ids.join(",")}`)
                  }
                  className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {keys.has(v.id) ? (
                    <LockOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <LockIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{v.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Dialog.Close render={<Button variant="outline" />}>
              Cancel
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
